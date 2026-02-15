"""MCP Process Manager — manages long-running persistent CLI processes.

Exposes four MCP tools:
  - start_process: Launch a named long-running process
  - stop_process:  Stop a managed process (with SIGTERM → SIGKILL escalation)
  - list_processes: List all managed processes and their status
  - get_output:    Retrieve buffered stdout/stderr from a process

Can run standalone:
    python -m jake_bot.process_manager
"""

from jake_bot.process_manager.supervisor import ProcessSupervisor
from jake_bot.process_manager.server import create_server

__all__ = ["ProcessSupervisor", "create_server"]
