"""Process Supervisor — spawns, tracks, and manages long-running CLI processes."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class ProcessStatus(str, Enum):
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"


@dataclass
class RingBuffer:
    """Fixed-size ring buffer for process output, tracked by sequence number."""

    max_size: int = 100_000  # characters
    _buf: deque[str] = field(default_factory=deque)
    _total_chars: int = 0
    _seq: int = 0  # monotonic sequence counter (one per append)

    def append(self, data: str) -> None:
        self._buf.append(data)
        self._total_chars += len(data)
        self._seq += 1
        # Evict oldest chunks until we're within budget
        while self._total_chars > self.max_size and self._buf:
            evicted = self._buf.popleft()
            self._total_chars -= len(evicted)

    @property
    def seq(self) -> int:
        return self._seq

    def tail(self, num_chars: int = 2000) -> str:
        """Return the last `num_chars` characters of buffered output."""
        parts: list[str] = []
        remaining = num_chars
        for chunk in reversed(self._buf):
            if remaining <= 0:
                break
            if len(chunk) <= remaining:
                parts.append(chunk)
                remaining -= len(chunk)
            else:
                parts.append(chunk[-remaining:])
                remaining = 0
        parts.reverse()
        return "".join(parts)

    def all(self) -> str:
        return "".join(self._buf)


@dataclass
class ManagedProcess:
    """State for a single managed process."""

    name: str
    command: str
    args: list[str]
    cwd: str
    env: dict[str, str] | None
    status: ProcessStatus = ProcessStatus.STARTING
    pid: int | None = None
    exit_code: int | None = None
    start_time: float = field(default_factory=time.time)
    stop_time: float | None = None
    stdout_buf: RingBuffer = field(default_factory=RingBuffer)
    stderr_buf: RingBuffer = field(default_factory=RingBuffer)
    _process: asyncio.subprocess.Process | None = field(
        default=None, repr=False
    )
    _reader_tasks: list[asyncio.Task[None]] = field(
        default_factory=list, repr=False
    )


class ProcessSupervisor:
    """Manages a registry of long-running processes."""

    def __init__(self) -> None:
        self._processes: dict[str, ManagedProcess] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(
        self,
        name: str,
        command: str,
        args: list[str] | None = None,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> ManagedProcess:
        """Start a named process. Idempotent — if already running, returns it."""
        if name in self._processes:
            existing = self._processes[name]
            if existing.status in (ProcessStatus.RUNNING, ProcessStatus.STARTING):
                return existing
            # Dead process with same name — remove and re-create
            del self._processes[name]

        resolved_cwd = cwd or os.getcwd()
        if not os.path.isdir(resolved_cwd):
            raise ValueError(f"Working directory does not exist: {resolved_cwd}")

        proc_args = args or []
        managed = ManagedProcess(
            name=name,
            command=command,
            args=proc_args,
            cwd=resolved_cwd,
            env=env,
        )
        self._processes[name] = managed

        # Merge environment
        spawn_env = os.environ.copy()
        if env:
            spawn_env.update(env)

        try:
            process = await asyncio.create_subprocess_exec(
                command,
                *proc_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=resolved_cwd,
                env=spawn_env,
                # Create new process group so we can kill the whole tree
                preexec_fn=os.setsid,
            )
        except Exception as exc:
            managed.status = ProcessStatus.FAILED
            managed.stderr_buf.append(f"Failed to start: {exc}\n")
            raise

        managed._process = process
        managed.pid = process.pid
        managed.status = ProcessStatus.RUNNING

        # Background readers for stdout/stderr
        managed._reader_tasks = [
            asyncio.create_task(
                self._read_stream(process.stdout, managed.stdout_buf),  # type: ignore[arg-type]
                name=f"{name}-stdout",
            ),
            asyncio.create_task(
                self._read_stream(process.stderr, managed.stderr_buf),  # type: ignore[arg-type]
                name=f"{name}-stderr",
            ),
        ]

        # Background waiter to update status on exit
        asyncio.create_task(
            self._wait_for_exit(managed),
            name=f"{name}-waiter",
        )

        return managed

    async def stop(
        self,
        name: str,
        force: bool = False,
        timeout: float = 10.0,
    ) -> ManagedProcess:
        """Stop a managed process. Sends SIGTERM, waits, then SIGKILL."""
        if name not in self._processes:
            raise KeyError(f"No process named '{name}'")

        managed = self._processes[name]
        if managed.status not in (ProcessStatus.RUNNING, ProcessStatus.STARTING):
            return managed

        proc = managed._process
        if proc is None:
            managed.status = ProcessStatus.STOPPED
            return managed

        managed.status = ProcessStatus.STOPPING

        try:
            pgid = os.getpgid(proc.pid)  # type: ignore[arg-type]
        except (ProcessLookupError, OSError):
            managed.status = ProcessStatus.STOPPED
            return managed

        # Phase 1: SIGTERM the process group
        sig = signal.SIGKILL if force else signal.SIGTERM
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, OSError):
            managed.status = ProcessStatus.STOPPED
            return managed

        if not force:
            # Wait for graceful shutdown, then escalate
            try:
                await asyncio.wait_for(proc.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass

        # Cleanup reader tasks
        for task in managed._reader_tasks:
            task.cancel()

        managed.status = ProcessStatus.STOPPED
        managed.exit_code = proc.returncode
        managed.stop_time = time.time()
        return managed

    async def stop_all(self) -> None:
        """Stop all running processes."""
        names = list(self._processes.keys())
        for name in names:
            managed = self._processes[name]
            if managed.status in (ProcessStatus.RUNNING, ProcessStatus.STARTING):
                try:
                    await self.stop(name)
                except Exception:
                    pass

    def list_all(self) -> list[dict[str, Any]]:
        """Return summary info for all managed processes."""
        result = []
        for managed in self._processes.values():
            uptime = None
            if managed.status == ProcessStatus.RUNNING:
                uptime = round(time.time() - managed.start_time, 1)
            elif managed.stop_time:
                uptime = round(managed.stop_time - managed.start_time, 1)

            result.append({
                "name": managed.name,
                "command": managed.command,
                "args": managed.args,
                "cwd": managed.cwd,
                "pid": managed.pid,
                "status": managed.status.value,
                "exit_code": managed.exit_code,
                "start_time": managed.start_time,
                "uptime_seconds": uptime,
            })
        return result

    def get_output(
        self,
        name: str,
        stream: str = "all",
        tail: int = 2000,
    ) -> dict[str, Any]:
        """Retrieve buffered output from a process."""
        if name not in self._processes:
            raise KeyError(f"No process named '{name}'")

        managed = self._processes[name]
        result: dict[str, Any] = {
            "name": name,
            "status": managed.status.value,
            "pid": managed.pid,
        }

        if stream in ("stdout", "all"):
            result["stdout"] = managed.stdout_buf.tail(tail)
            result["stdout_seq"] = managed.stdout_buf.seq
        if stream in ("stderr", "all"):
            result["stderr"] = managed.stderr_buf.tail(tail)
            result["stderr_seq"] = managed.stderr_buf.seq

        return result

    def remove(self, name: str) -> None:
        """Remove a stopped process from the registry."""
        if name not in self._processes:
            raise KeyError(f"No process named '{name}'")
        managed = self._processes[name]
        if managed.status in (ProcessStatus.RUNNING, ProcessStatus.STARTING):
            raise RuntimeError(
                f"Cannot remove running process '{name}'. Stop it first."
            )
        del self._processes[name]

    async def bootstrap(self, config_path: str | Path) -> None:
        """Start all services defined in a JSON config file.

        Config format:
            {
                "service-name": {
                    "command": "python",
                    "args": ["-m", "my_app"],
                    "cwd": "/path/to/project",
                    "env": {"KEY": "VALUE"}
                }
            }
        """
        path = Path(config_path)
        if not path.exists():
            log.warning("No services config at %s — skipping bootstrap", path)
            return

        with open(path) as f:
            services: dict[str, dict[str, Any]] = json.load(f)

        for name, svc in services.items():
            try:
                managed = await self.start(
                    name=name,
                    command=svc["command"],
                    args=svc.get("args"),
                    cwd=svc.get("cwd"),
                    env=svc.get("env"),
                )
                log.info(
                    "Bootstrapped service '%s' (pid=%s)", name, managed.pid
                )
            except Exception:
                log.exception("Failed to bootstrap service '%s'", name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _read_stream(
        stream: asyncio.StreamReader,
        buf: RingBuffer,
    ) -> None:
        """Read from an async stream into a ring buffer."""
        try:
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    break
                buf.append(chunk.decode("utf-8", errors="replace"))
        except asyncio.CancelledError:
            pass

    @staticmethod
    async def _wait_for_exit(managed: ManagedProcess) -> None:
        """Wait for process to exit and update status."""
        proc = managed._process
        if proc is None:
            return
        code = await proc.wait()
        if managed.status == ProcessStatus.STOPPING:
            # Already being stopped by stop(), let stop() handle status
            return
        managed.exit_code = code
        managed.stop_time = time.time()
        managed.status = (
            ProcessStatus.STOPPED if code == 0 else ProcessStatus.FAILED
        )
