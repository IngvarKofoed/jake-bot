from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from pathlib import Path

from .models import (
    ConversationInfo,
    PluginEvent,
    PluginEventType,
    ResponseBlockType,
)
from .plugin import CliPlugin, clean_tool_name
from .process_manager.server import DEFAULT_PORT

log = logging.getLogger(__name__)


def _parse_relative_time(time_str: str) -> datetime:
    """Best-effort parsing of relative time strings from Gemini CLI.

    Handles strings like "1 day ago", "23 hours ago", "5 minutes ago".
    Falls back to ``datetime.now()`` if parsing fails.
    """
    now = datetime.now()
    match = re.match(r"(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago", time_str)
    if not match:
        return now

    amount = int(match.group(1))
    unit = match.group(2)
    delta_map = {
        "second": timedelta(seconds=amount),
        "minute": timedelta(minutes=amount),
        "hour": timedelta(hours=amount),
        "day": timedelta(days=amount),
        "week": timedelta(weeks=amount),
        "month": timedelta(days=amount * 30),
    }
    return now - delta_map.get(unit, timedelta(0))


class GeminiPlugin(CliPlugin):
    plugin_id = "gemini"
    display_name = "Gemini"

    def __init__(self, *, cli_path: str = "gemini") -> None:
        self.cli_path = cli_path

    async def execute(
        self,
        workdir: str,
        message: str,
        *,
        session_id: str | None = None,
    ) -> AsyncIterator[PluginEvent]:
        cmd = [self.cli_path, "-p", message, "-o", "stream-json", "-y"]
        if session_id:
            cmd.extend(["--resume", session_id])

        # Monotonic block ID generator for this turn
        block_counter = itertools.count()

        def _next_block_id() -> str:
            return f"b{next(block_counter)}"

        event_queue: asyncio.Queue[PluginEvent | None] = asyncio.Queue()

        async def _run_subprocess() -> None:
            # State for streaming text blocks
            text_block_id: str | None = None
            text_block_open = False
            stored_session_id: str | None = session_id

            # Inject MCP server config into user-level ~/.gemini/settings.json
            # (project-level doesn't work reliably because the Gemini CLI
            # resolves the project root via .git, not the CWD).
            settings_path = Path.home() / ".gemini" / "settings.json"
            original_settings: str | None = None
            try:
                if settings_path.exists():
                    original_settings = settings_path.read_text()
                    existing = json.loads(original_settings)
                else:
                    existing = {}

                mcp_servers = existing.get("mcpServers", {})
                mcp_servers["process-manager"] = {
                    "url": f"http://127.0.0.1:{DEFAULT_PORT}/mcp",
                    "type": "http",
                    "trust": True,
                }
                existing["mcpServers"] = mcp_servers
                settings_path.write_text(json.dumps(existing, indent=2) + "\n")
            except Exception:
                log.warning("Failed to inject MCP config into %s", settings_path, exc_info=True)

            async def _close_text_block() -> None:
                nonlocal text_block_id, text_block_open
                if text_block_open and text_block_id:
                    await event_queue.put(PluginEvent(
                        type=PluginEventType.BLOCK_CLOSE,
                        block_id=text_block_id,
                    ))
                    text_block_id = None
                    text_block_open = False

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=workdir,
                )

                got_result = False

                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        log.warning("Ignoring malformed JSON line from Gemini: %s", line[:200])
                        continue

                    event_type = event.get("type")

                    # -- init: extract session ID ---------------------
                    if event_type == "init":
                        stored_session_id = event.get("session_id", stored_session_id)

                    # -- user message echo: skip ---------------------
                    elif event_type == "message" and event.get("role") == "user":
                        continue

                    # -- assistant message (streaming text) -----------
                    elif event_type == "message" and event.get("role") == "assistant":
                        content = event.get("content", "")
                        if not content:
                            continue

                        if not text_block_open:
                            text_block_id = _next_block_id()
                            text_block_open = True
                            await event_queue.put(PluginEvent(
                                type=PluginEventType.BLOCK_OPEN,
                                block_id=text_block_id,
                                block_type=ResponseBlockType.TEXT,
                            ))

                        await event_queue.put(PluginEvent(
                            type=PluginEventType.BLOCK_DELTA,
                            block_id=text_block_id,
                            content=content,
                        ))

                    # -- tool_use ------------------------------------
                    elif event_type == "tool_use":
                        await _close_text_block()
                        display_name = clean_tool_name(event.get("tool_name", "unknown"))
                        await event_queue.put(PluginEvent(
                            type=PluginEventType.BLOCK_EMIT,
                            block_id=_next_block_id(),
                            block_type=ResponseBlockType.TOOL_USE,
                            content=display_name,
                            metadata={
                                "tool_name": display_name,
                                "tool_id": event.get("tool_id", ""),
                                "input": event.get("parameters", {}),
                            },
                        ))

                    # -- tool_result --------------------------------
                    elif event_type == "tool_result":
                        await _close_text_block()
                        output = event.get("output", "")
                        is_error = event.get("status") == "error"
                        if is_error and not output:
                            err = event.get("error", {})
                            output = err.get("message", "") if isinstance(err, dict) else str(err)
                        await event_queue.put(PluginEvent(
                            type=PluginEventType.BLOCK_EMIT,
                            block_id=_next_block_id(),
                            block_type=ResponseBlockType.TOOL_RESULT,
                            content=output,
                            metadata={
                                "tool_use_id": event.get("tool_id", ""),
                                "is_error": is_error,
                            },
                        ))

                    # -- result (turn complete) ----------------------
                    elif event_type == "result":
                        await _close_text_block()
                        got_result = True
                        stats = event.get("stats", {})
                        await event_queue.put(PluginEvent(
                            type=PluginEventType.COMPLETE,
                            content=event.get("status", "success"),
                            session_id=stored_session_id,
                            cost_usd=None,
                            duration_ms=stats.get("duration_ms"),
                        ))

                # Wait for process to finish
                await proc.wait()

                # If no result event arrived but process exited with error
                if not got_result and proc.returncode != 0:
                    stderr_bytes = await proc.stderr.read()
                    stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()
                    await _close_text_block()
                    await event_queue.put(PluginEvent(
                        type=PluginEventType.ERROR,
                        content=f"Gemini CLI exited with code {proc.returncode}: {stderr_text}",
                    ))
                elif not got_result:
                    # Process exited cleanly but no result event — synthesize one
                    await _close_text_block()
                    await event_queue.put(PluginEvent(
                        type=PluginEventType.COMPLETE,
                        content="success",
                        session_id=stored_session_id,
                    ))

            except Exception as exc:
                log.exception("Gemini plugin error")
                await event_queue.put(PluginEvent(
                    type=PluginEventType.ERROR,
                    content=str(exc),
                ))
            finally:
                # Restore original ~/.gemini/settings.json
                try:
                    if original_settings is not None:
                        settings_path.write_text(original_settings)
                except Exception:
                    log.warning("Failed to restore %s", settings_path, exc_info=True)

                await event_queue.put(None)  # sentinel

        task = asyncio.create_task(_run_subprocess())
        try:
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield event
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    async def list_conversations(
        self, workdir: str | None = None
    ) -> list[ConversationInfo]:
        """List past Gemini conversations by running ``gemini --list-sessions``."""
        if workdir is None:
            workdir = str(Path.home())

        try:
            proc = await asyncio.create_subprocess_exec(
                self.cli_path,
                "--list-sessions",
                cwd=workdir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        except asyncio.TimeoutError:
            log.warning("gemini --list-sessions timed out")
            return []
        except Exception:
            log.exception("Failed to list Gemini conversations")
            return []

        if proc.returncode != 0:
            log.warning(
                "gemini --list-sessions exited %d: %s",
                proc.returncode,
                stderr.decode("utf-8", errors="replace")[:200],
            )
            return []

        results: list[ConversationInfo] = []
        output = stdout.decode("utf-8", errors="replace")

        # Lines look like:
        #   1. I need you to design an architecture... (1 day ago) [81f78662-...]
        pattern = re.compile(
            r"^\s*\d+\.\s+(.+?)\s+\((.+?)\)\s+\[([a-f0-9-]{36})\]",
        )

        for line in output.splitlines():
            match = pattern.match(line)
            if match:
                title, time_ago, session_id = match.groups()
                results.append(
                    ConversationInfo(
                        id=session_id,
                        title=title.strip(),
                        timestamp=_parse_relative_time(time_ago),
                        project=workdir,
                    )
                )

        return results[:20]
