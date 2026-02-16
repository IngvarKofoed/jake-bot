from __future__ import annotations

import asyncio
import itertools
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    query,
)
from claude_agent_sdk.types import McpHttpServerConfig

from jake_bot.process_manager.server import DEFAULT_PORT

from .models import (
    ConversationInfo,
    PluginEvent,
    PluginEventType,
    ResponseBlockType,
)
from .plugin import CliPlugin

log = logging.getLogger(__name__)


def _clean_tool_name(raw: str) -> str:
    """Normalize a CLI-specific tool name into a human-readable form.

    Claude Code uses ``mcp__server-name__tool_name`` for MCP tools and
    ``snake_case`` for built-in tools.  We turn separators into spaces
    and title-case the result so the formatter receives clean display names.

    Examples:
        mcp__process-manager__restart_process → Process Manager · Restart Process
        Read                                  → Read
        write_file                            → Write File
    """
    # MCP-style: mcp__<server>__<tool>
    if raw.startswith("mcp__"):
        parts = raw.split("__", 2)  # ['mcp', 'server-name', 'tool_name']
        if len(parts) == 3:
            server = parts[1].replace("-", " ").replace("_", " ").title()
            tool = parts[2].replace("-", " ").replace("_", " ").title()
            return f"{server} · {tool}"

    # Built-in tool: snake_case or PascalCase — just humanize underscores
    return raw.replace("_", " ").replace("-", " ").strip().title() if "_" in raw or "-" in raw else raw


class ClaudeCodePlugin(CliPlugin):
    plugin_id = "claude"
    display_name = "Claude Code"

    def __init__(
        self,
        *,
        max_turns: int = 30,
        max_budget_usd: float = 5.0,
    ) -> None:
        self.max_turns = max_turns
        self.max_budget_usd = max_budget_usd

    async def execute(
        self,
        workdir: str,
        message: str,
        *,
        session_id: str | None = None,
    ) -> AsyncIterator[PluginEvent]:
        options = ClaudeAgentOptions(
            permission_mode="bypassPermissions",
            max_turns=self.max_turns,
            max_budget_usd=self.max_budget_usd,
            cwd=str(Path(workdir).resolve()),
            setting_sources=["user", "project", "local"],
            mcp_servers={
                "process-manager": McpHttpServerConfig(
                    type="http",
                    url=f"http://127.0.0.1:{DEFAULT_PORT}/mcp",
                ),
            },
        )
        if session_id:
            options.resume = session_id

        # Monotonic block ID generator for this turn
        block_counter = itertools.count()

        def _next_block_id() -> str:
            return f"b{next(block_counter)}"

        # Collect events in a queue so the SDK query generator is fully
        # consumed within a single task, avoiding the anyio cancel-scope
        # "different task" RuntimeError on cleanup.
        event_queue: asyncio.Queue[PluginEvent | None] = asyncio.Queue()

        async def _run_query() -> None:
            try:
                async for msg in query(prompt=message, options=options):
                    if isinstance(msg, AssistantMessage):
                        # Check for API-level errors on the message
                        if msg.error:
                            await event_queue.put(PluginEvent(
                                type=PluginEventType.BLOCK_EMIT,
                                block_id=_next_block_id(),
                                block_type=ResponseBlockType.ERROR,
                                content=f"API error: {msg.error}",
                            ))

                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                # Text arrives as one complete block from the
                                # SDK (non-streaming mode).  We emit it as
                                # OPEN → DELTA → CLOSE so the coordinator can
                                # stream it progressively to Discord.
                                bid = _next_block_id()
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_OPEN,
                                    block_id=bid,
                                    block_type=ResponseBlockType.TEXT,
                                ))
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_DELTA,
                                    block_id=bid,
                                    content=block.text,
                                ))
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_CLOSE,
                                    block_id=bid,
                                ))

                            elif isinstance(block, ThinkingBlock):
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_EMIT,
                                    block_id=_next_block_id(),
                                    block_type=ResponseBlockType.THINKING,
                                    content=block.thinking,
                                ))

                            elif isinstance(block, ToolUseBlock):
                                display_name = _clean_tool_name(block.name)
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_EMIT,
                                    block_id=_next_block_id(),
                                    block_type=ResponseBlockType.TOOL_USE,
                                    content=display_name,
                                    metadata={
                                        "tool_name": display_name,
                                        "tool_id": block.id,
                                        "input": block.input,
                                    },
                                ))

                            elif isinstance(block, ToolResultBlock):
                                # content can be str, list[dict], or None
                                if isinstance(block.content, str):
                                    text = block.content
                                elif isinstance(block.content, list):
                                    # Multi-part result — extract text parts
                                    parts = []
                                    for part in block.content:
                                        if isinstance(part, dict) and "text" in part:
                                            parts.append(part["text"])
                                    text = "\n".join(parts) if parts else str(block.content)
                                else:
                                    text = ""

                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.BLOCK_EMIT,
                                    block_id=_next_block_id(),
                                    block_type=ResponseBlockType.TOOL_RESULT,
                                    content=text,
                                    metadata={
                                        "tool_use_id": block.tool_use_id,
                                        "is_error": block.is_error or False,
                                    },
                                ))

                    elif isinstance(msg, SystemMessage):
                        await event_queue.put(PluginEvent(
                            type=PluginEventType.BLOCK_EMIT,
                            block_id=_next_block_id(),
                            block_type=ResponseBlockType.SYSTEM,
                            content=str(msg.data),
                            metadata={"subtype": msg.subtype},
                        ))

                    elif isinstance(msg, ResultMessage):
                        await event_queue.put(PluginEvent(
                            type=PluginEventType.COMPLETE,
                            content=msg.result or "",
                            session_id=msg.session_id,
                            cost_usd=msg.total_cost_usd,
                            duration_ms=msg.duration_ms,
                        ))

            except Exception as exc:
                log.exception("Claude Code plugin error")
                await event_queue.put(PluginEvent(
                    type=PluginEventType.ERROR,
                    content=str(exc),
                ))
            finally:
                await event_queue.put(None)  # sentinel

        task = asyncio.create_task(_run_query())
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
        """Best-effort listing of past Claude Code conversations."""
        results: list[ConversationInfo] = []
        projects_dir = Path.home() / ".claude" / "projects"
        if not projects_dir.exists():
            return results

        for project_dir in projects_dir.iterdir():
            if not project_dir.is_dir():
                continue
            for session_file in sorted(project_dir.glob("*.jsonl"), reverse=True):
                try:
                    first_line = session_file.open().readline()
                    if not first_line.strip():
                        continue
                    data = json.loads(first_line)
                    title = data.get("title", session_file.stem)
                    ts = datetime.fromtimestamp(session_file.stat().st_mtime)
                    results.append(
                        ConversationInfo(
                            id=session_file.stem,
                            title=title if isinstance(title, str) else session_file.stem,
                            timestamp=ts,
                            project=project_dir.name,
                        )
                    )
                except Exception:
                    continue

        results.sort(key=lambda c: c.timestamp, reverse=True)
        return results[:20]
