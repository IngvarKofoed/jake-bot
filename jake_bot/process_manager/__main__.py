"""Run the process manager as a persistent MCP daemon over HTTP.

This is the top-level entry point.  It starts the MCP server and
bootstraps any services listed in services.json (e.g. jake-bot).

Usage:
    python -m jake_bot.process_manager [--port PORT] [--services FILE]

Managed services survive individual Claude CLI sessions — the daemon
stays alive and tracks all spawned processes across conversations.
"""

import argparse
import asyncio
import logging
import signal
from pathlib import Path

import uvicorn

from jake_bot.process_manager.server import DEFAULT_PORT, create_server
from jake_bot.process_manager.supervisor import ProcessSupervisor

log = logging.getLogger(__name__)

DEFAULT_SERVICES = Path(__file__).parent / "services.json"


async def _run(port: int, services_path: Path) -> None:
    supervisor = ProcessSupervisor()
    server = create_server(supervisor=supervisor, port=port)

    # Bootstrap configured services
    await supervisor.bootstrap(services_path)

    # Run uvicorn in the same event loop so the supervisor's async
    # tasks (stream readers, exit waiters) stay alive.
    app = server.streamable_http_app()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="info",
    )
    uvi = uvicorn.Server(config)

    # Use _serve() instead of serve() to bypass uvicorn's
    # capture_signals() context manager which overrides signal
    # handlers with signal.signal() — preventing our async
    # handlers from working.
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown.set)

    serve_task = asyncio.create_task(uvi._serve())

    # Block until a signal arrives
    await shutdown.wait()
    log.info("Signal received — shutting down")

    # Tell uvicorn to stop, then clean up child processes
    uvi.should_exit = True
    await serve_task
    log.info("Stopping all managed processes")
    await supervisor.stop_all()


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP Process Manager daemon")
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--services", type=Path, default=DEFAULT_SERVICES,
        help=f"Services config file (default: {DEFAULT_SERVICES})",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [process-manager] %(levelname)s %(message)s",
    )

    # The MCP SDK logs a noisy full traceback when the HTTP client
    # disconnects before the response is sent (ClosedResourceError).
    # This is harmless — downgrade it from ERROR to DEBUG.
    class _SuppressDisconnect(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            if record.exc_info and record.exc_info[1] is not None:
                chain = str(record.exc_info[1])
                if "ClosedResourceError" in chain:
                    record.levelno = logging.DEBUG
                    record.levelname = "DEBUG"
                    record.msg = "Client disconnected before response completed"
                    record.exc_info = None
                    record.exc_text = None
            return True

    logging.getLogger("mcp.server.streamable_http_manager").addFilter(
        _SuppressDisconnect()
    )

    log.info("Starting process-manager on http://127.0.0.1:%d/mcp", args.port)
    asyncio.run(_run(args.port, args.services))


if __name__ == "__main__":
    main()
