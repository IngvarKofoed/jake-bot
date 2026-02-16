from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from .models import ConversationInfo, PluginEvent


def clean_tool_name(raw: str) -> str:
    """Normalize a CLI-specific tool name into a human-readable form.

    Both Claude Code and Gemini CLI use ``mcp__server-name__tool_name`` for
    MCP tools and ``snake_case`` for built-in tools.  We turn separators into
    spaces and title-case the result so the formatter receives clean display
    names.

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


class CliPlugin(ABC):
    plugin_id: str
    display_name: str

    @abstractmethod
    def execute(
        self,
        workdir: str,
        message: str,
        *,
        session_id: str | None = None,
    ) -> AsyncIterator[PluginEvent]:
        ...

    @abstractmethod
    async def list_conversations(
        self, workdir: str | None = None
    ) -> list[ConversationInfo]:
        ...
