from __future__ import annotations

import asyncio
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
    ToolUseBlock,
    query,
)

from .models import ConversationInfo, PluginEvent, PluginEventType
from .plugin import CliPlugin

log = logging.getLogger(__name__)


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
        )
        if session_id:
            options.resume = session_id

        # Collect events in a queue so the SDK query generator is fully
        # consumed within a single task, avoiding the anyio cancel-scope
        # "different task" RuntimeError on cleanup.
        event_queue: asyncio.Queue[PluginEvent | None] = asyncio.Queue()

        async def _run_query() -> None:
            try:
                async for msg in query(prompt=message, options=options):
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.TEXT_DELTA,
                                    content=block.text,
                                ))
                            elif isinstance(block, ToolUseBlock):
                                await event_queue.put(PluginEvent(
                                    type=PluginEventType.STATUS,
                                    content=f"Using tool: {block.name}",
                                    metadata={"tool": block.name, "input": block.input},
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
