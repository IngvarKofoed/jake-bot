"""MCP Server exposing process management tools over stdio or HTTP."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from jake_bot.process_manager.supervisor import ProcessSupervisor

# Default port for the persistent HTTP daemon
DEFAULT_PORT = 8901


def create_server(
    supervisor: ProcessSupervisor | None = None,
    port: int = DEFAULT_PORT,
) -> FastMCP:
    """Create and configure the MCP process manager server."""

    sv = supervisor or ProcessSupervisor()

    mcp = FastMCP(
        name="process-manager",
        instructions=(
            "Manages long-running CLI processes (dev servers, watchers, builds). "
            "Use start_process to launch named services, get_output to check logs, "
            "list_processes for status, and stop_process to shut them down."
        ),
        host="127.0.0.1",
        port=port,
        stateless_http=True,
    )

    # ------------------------------------------------------------------
    # Tool: start_process
    # ------------------------------------------------------------------
    @mcp.tool()
    async def start_process(
        name: str,
        command: str,
        args: list[str] | None = None,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> dict:
        """Start a named long-running process.

        Idempotent — if a process with this name is already running, returns
        its current status instead of starting a duplicate.

        Args:
            name: Unique name for this process (e.g. "dev-server", "db").
            command: The executable to run (e.g. "npm", "python", "postgres").
            args: Command-line arguments (e.g. ["run", "dev"]).
            cwd: Working directory. Defaults to the current directory.
            env: Extra environment variables to set (merged with current env).
        """
        try:
            managed = await sv.start(
                name=name,
                command=command,
                args=args,
                cwd=cwd,
                env=env,
            )
            return {
                "name": managed.name,
                "pid": managed.pid,
                "status": managed.status.value,
                "command": f"{managed.command} {' '.join(managed.args)}".strip(),
                "cwd": managed.cwd,
            }
        except Exception as exc:
            return {"name": name, "status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Tool: stop_process
    # ------------------------------------------------------------------
    @mcp.tool()
    async def stop_process(
        name: str,
        force: bool = False,
    ) -> dict:
        """Stop a managed process.

        Sends SIGTERM to the process group, waits up to 10 seconds for
        graceful shutdown, then escalates to SIGKILL.

        Args:
            name: Name of the process to stop.
            force: If True, send SIGKILL immediately instead of SIGTERM.
        """
        try:
            managed = await sv.stop(name=name, force=force)
            return {
                "name": managed.name,
                "status": managed.status.value,
                "exit_code": managed.exit_code,
            }
        except KeyError:
            return {"name": name, "status": "not_found", "error": f"No process named '{name}'"}
        except Exception as exc:
            return {"name": name, "status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Tool: list_processes
    # ------------------------------------------------------------------
    @mcp.tool()
    async def list_processes() -> dict:
        """List all managed processes with their current status.

        Returns name, command, PID, status, exit code, and uptime for
        every process in the registry (running, stopped, or failed).
        """
        processes = sv.list_all()
        return {
            "count": len(processes),
            "processes": processes,
        }

    # ------------------------------------------------------------------
    # Tool: get_output
    # ------------------------------------------------------------------
    @mcp.tool()
    async def get_output(
        name: str,
        stream: str = "all",
        tail: int = 2000,
    ) -> dict:
        """Get buffered stdout/stderr output from a process.

        Retrieves the most recent output from the process's ring buffer.
        Use this to check logs, watch for errors, or monitor startup.

        Args:
            name: Name of the process.
            stream: Which stream(s) to retrieve: "stdout", "stderr", or "all".
            tail: Number of characters to retrieve from the end of the buffer.
                  Defaults to 2000. Max ~100,000 (buffer size).
        """
        try:
            return sv.get_output(name=name, stream=stream, tail=tail)
        except KeyError:
            return {"name": name, "status": "not_found", "error": f"No process named '{name}'"}

    return mcp
