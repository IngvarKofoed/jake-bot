from __future__ import annotations

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
        allowed_tools: list[str] | None = None,
        max_turns: int = 30,
        max_budget_usd: float = 5.0,
    ) -> None:
        self.allowed_tools = allowed_tools or [
            "Read", "Write", "Edit", "Bash", "Glob", "Grep",
            "WebSearch", "WebFetch", "Task",
        ]
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
            allowed_tools=self.allowed_tools,
            permission_mode="bypassPermissions",
            max_turns=self.max_turns,
            max_budget_usd=self.max_budget_usd,
            cwd=workdir,
        )
        if session_id:
            options.resume = session_id

        try:
            async for msg in query(prompt=message, options=options):
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            yield PluginEvent(
                                type=PluginEventType.TEXT_DELTA,
                                content=block.text,
                            )
                        elif isinstance(block, ToolUseBlock):
                            yield PluginEvent(
                                type=PluginEventType.STATUS,
                                content=f"Using tool: {block.name}",
                                metadata={"tool": block.name, "input": block.input},
                            )
                elif isinstance(msg, ResultMessage):
                    yield PluginEvent(
                        type=PluginEventType.COMPLETE,
                        content=msg.result or "",
                        session_id=msg.session_id,
                        cost_usd=msg.total_cost_usd,
                        duration_ms=msg.duration_ms,
                    )
        except Exception as exc:
            log.exception("Claude Code plugin error")
            yield PluginEvent(
                type=PluginEventType.ERROR,
                content=str(exc),
            )

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
