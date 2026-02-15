"""Formatter — renders ResponseBlocks into platform-specific output.

The Formatter is the bridge between semantic content (what a block IS) and
platform rendering (how it LOOKS on Discord, Slack, etc.).  Each platform
gets its own subclass; plugins never deal with platform details.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any

from .models import ResponseBlockType

# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class Formatter(ABC):
    """Render ResponseBlocks into platform-specific strings."""

    @abstractmethod
    def format_block_open(
        self,
        block_type: ResponseBlockType,
        metadata: dict[str, Any],
    ) -> str:
        """Return the opening decoration for a streaming block (may be empty)."""
        ...

    @abstractmethod
    def format_block_content(
        self,
        block_type: ResponseBlockType,
        content: str,
        metadata: dict[str, Any],
    ) -> str:
        """Return the full rendered form of a streaming block's accumulated content."""
        ...

    @abstractmethod
    def format_emit(
        self,
        block_type: ResponseBlockType,
        content: str,
        metadata: dict[str, Any],
    ) -> str:
        """Render a one-shot (complete) block."""
        ...


# ---------------------------------------------------------------------------
# Discord implementation
# ---------------------------------------------------------------------------

# Match bare URLs not already inside <angle brackets>
_BARE_URL_RE = re.compile(r"(?<![<(])(https?://\S+)")

# Maximum characters to show for tool result output
_TOOL_RESULT_MAX_CHARS = 800


def _suppress_embeds(text: str) -> str:
    """Wrap bare URLs in <brackets> so Discord won't generate previews."""
    return _BARE_URL_RE.sub(r"<\1>", text)


class DiscordFormatter(Formatter):
    """Render ResponseBlocks for Discord markdown."""

    # -- streaming blocks (OPEN / DELTA / CLOSE cycle) ---------------------

    def format_block_open(
        self,
        block_type: ResponseBlockType,
        metadata: dict[str, Any],
    ) -> str:
        # Most blocks don't need an opening marker — the content render
        # handles the full presentation.  We return "" so the coordinator
        # can just concatenate.
        return ""

    def format_block_content(
        self,
        block_type: ResponseBlockType,
        content: str,
        metadata: dict[str, Any],
    ) -> str:
        """Render the *full current content* of a streaming block.

        Called on every DELTA — the coordinator replaces the previous render
        of this block with this new one.
        """
        if block_type == ResponseBlockType.TEXT:
            return _suppress_embeds(content)

        if block_type == ResponseBlockType.THINKING:
            # Show a dimmed one-liner while thinking streams in
            preview = content[:80].replace("\n", " ")
            if len(content) > 80:
                preview += "…"
            return f"\n-# 💭 {preview}\n"

        if block_type == ResponseBlockType.TOOL_RESULT:
            return self._render_tool_result(content, metadata)

        # Fallback — render as plain text
        return _suppress_embeds(content)

    # -- one-shot blocks (EMIT) --------------------------------------------

    def format_emit(
        self,
        block_type: ResponseBlockType,
        content: str,
        metadata: dict[str, Any],
    ) -> str:
        if block_type == ResponseBlockType.TOOL_USE:
            return self._render_tool_use(content, metadata)

        if block_type == ResponseBlockType.TOOL_RESULT:
            return self._render_tool_result(content, metadata)

        if block_type == ResponseBlockType.THINKING:
            preview = content[:80].replace("\n", " ")
            if len(content) > 80:
                preview += "…"
            return f"\n-# 💭 {preview}\n"

        if block_type == ResponseBlockType.ERROR:
            return f"\n❌ **Error:** {content}\n"

        if block_type == ResponseBlockType.SYSTEM:
            subtype = metadata.get("subtype", "")
            if subtype:
                return f"\n-# ℹ️ {subtype}: {content}\n"
            return f"\n-# ℹ️ {content}\n"

        if block_type == ResponseBlockType.TEXT:
            return _suppress_embeds(content)

        return content

    # -- private helpers ---------------------------------------------------

    def _render_tool_use(
        self, content: str, metadata: dict[str, Any]
    ) -> str:
        tool_name = metadata.get("tool_name", "tool")
        return f"\n-# 🔧 {tool_name}...\n"

    def _render_tool_result(
        self, content: str, metadata: dict[str, Any]
    ) -> str:
        if not content:
            return ""

        is_error = metadata.get("is_error", False)
        prefix = "⚠️ " if is_error else ""

        truncated = content[:_TOOL_RESULT_MAX_CHARS]
        if len(content) > _TOOL_RESULT_MAX_CHARS:
            truncated += f"\n… ({len(content) - _TOOL_RESULT_MAX_CHARS} chars truncated)"

        return f"\n{prefix}```\n{truncated}\n```\n"
