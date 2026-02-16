"""Stream coordinator — consumes PluginEvents and streams them to Discord.

Manages block state (open blocks with accumulated content), delegates
rendering to a Formatter, and handles Discord rate-limiting / message
splitting.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import discord

from .formatter import Formatter
from .models import PluginEvent, PluginEventType, ResponseBlockType, ToolRecord

log = logging.getLogger(__name__)

DISCORD_CHAR_LIMIT = 1900
MIN_EDIT_INTERVAL = 0.5  # seconds — ~2 edits/sec to stay under rate limits


# ---------------------------------------------------------------------------
# Code-fence repair for message splitting
# ---------------------------------------------------------------------------

def _unclosed_code_fence(text: str) -> str | None:
    """If text has an unclosed ``` block, return the fence line (e.g. '```json').

    Returns None if all code blocks are properly closed.
    """
    fence = None
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            if fence is None:
                fence = stripped
            else:
                fence = None
    return fence


# ---------------------------------------------------------------------------
# Block state tracker
# ---------------------------------------------------------------------------

@dataclass
class _OpenBlock:
    """Tracks accumulated state for a streaming block."""
    block_type: ResponseBlockType
    metadata: dict[str, Any] = field(default_factory=dict)
    content: str = ""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def stream_to_discord(
    events: AsyncIterator[PluginEvent],
    channel: discord.abc.Messageable,
    formatter: Formatter,
) -> PluginEvent | None:
    """Consume plugin events and stream them into Discord messages.

    Returns the final COMPLETE or ERROR event, or None if the stream
    ended without one.
    """
    # Discord message state
    buffer = ""
    current_msg: discord.Message | None = None
    last_edit = 0.0
    final_event: PluginEvent | None = None

    # Open block tracking
    open_blocks: dict[str, _OpenBlock] = {}

    # We track the rendered output of the *current* streaming block so we
    # can replace its previous render when new deltas arrive.
    current_block_id: str | None = None
    current_block_render_start: int = 0  # position in buffer where current block's render begins

    # Tool tracking — transient indicator + thread archive
    tool_records: list[ToolRecord] = []
    tool_id_to_record: dict[str, ToolRecord] = {}
    tool_indicator_text: str | None = None

    def strip_tool_indicator() -> None:
        nonlocal buffer, tool_indicator_text
        if tool_indicator_text and buffer.endswith(tool_indicator_text):
            buffer = buffer[: -len(tool_indicator_text)]
        tool_indicator_text = None

    async def flush(force: bool = False) -> None:
        nonlocal current_msg, last_edit, buffer
        now = time.monotonic()
        if not force and (now - last_edit) < MIN_EDIT_INTERVAL:
            return
        if not buffer:
            return

        text = buffer[:DISCORD_CHAR_LIMIT]
        if current_msg is None:
            current_msg = await channel.send(text)
        else:
            try:
                await current_msg.edit(content=text)
            except discord.HTTPException:
                log.warning("Failed to edit message, sending new one")
                current_msg = await channel.send(text)
        last_edit = time.monotonic()

    async def split_if_needed() -> None:
        """If buffer exceeds the char limit, finalize current message and start new."""
        nonlocal buffer, current_msg, current_block_render_start
        while len(buffer) > DISCORD_CHAR_LIMIT:
            overflow = buffer[DISCORD_CHAR_LIMIT:]
            buffer = buffer[:DISCORD_CHAR_LIMIT]
            # Close unclosed code fence before splitting
            fence = _unclosed_code_fence(buffer)
            if fence:
                buffer += "\n```"
            await flush(force=True)
            # Start a new message
            current_msg = None
            buffer = (fence + "\n" + overflow) if fence else overflow
            current_block_render_start = 0

    async for event in events:
        # Filter out system messages (e.g. init) — not useful in Discord output
        if event.block_type == ResponseBlockType.SYSTEM:
            log.debug("Filtered system event: %s", event.metadata.get("subtype"))
            continue

        if event.type == PluginEventType.BLOCK_OPEN:
            bid = event.block_id
            if bid:
                strip_tool_indicator()
                open_blocks[bid] = _OpenBlock(
                    block_type=event.block_type or ResponseBlockType.TEXT,
                    metadata=event.metadata,
                )
                current_block_id = bid
                current_block_render_start = len(buffer)
                # Ask formatter for opening decoration
                opening = formatter.format_block_open(
                    open_blocks[bid].block_type,
                    event.metadata,
                )
                if opening:
                    buffer += opening

        elif event.type == PluginEventType.BLOCK_DELTA:
            bid = event.block_id
            if bid and bid in open_blocks:
                ob = open_blocks[bid]
                ob.content += event.content

                # Re-render the entire block content from scratch
                rendered = formatter.format_block_content(
                    ob.block_type, ob.content, ob.metadata,
                )
                # Replace previous render of this block in the buffer
                buffer = buffer[:current_block_render_start] + rendered

                await split_if_needed()
                await flush()

        elif event.type == PluginEventType.BLOCK_CLOSE:
            bid = event.block_id
            if bid and bid in open_blocks:
                del open_blocks[bid]
                current_block_id = None
                # The final render is already in the buffer from the last DELTA

        elif event.type == PluginEventType.BLOCK_EMIT:
            block_type = event.block_type or ResponseBlockType.TEXT

            if block_type == ResponseBlockType.TOOL_USE:
                # Record for thread archive
                rec = ToolRecord(
                    tool_name=event.metadata.get("tool_name", "tool"),
                    tool_input=event.metadata.get("input", {}),
                    tool_id=event.metadata.get("tool_id", ""),
                )
                tool_records.append(rec)
                if rec.tool_id:
                    tool_id_to_record[rec.tool_id] = rec

                # Transient indicator — replace previous one
                strip_tool_indicator()
                indicator = formatter.format_emit(block_type, event.content, event.metadata)
                tool_indicator_text = indicator
                buffer += indicator

                current_block_id = None
                current_block_render_start = len(buffer)
                await split_if_needed()
                await flush()

            elif block_type == ResponseBlockType.TOOL_RESULT:
                # Don't render in main message; fill in the matching record
                use_id = event.metadata.get("tool_use_id", "")
                if use_id and use_id in tool_id_to_record:
                    rec = tool_id_to_record[use_id]
                    rec.result_content = event.content
                    rec.is_error = event.metadata.get("is_error", False)

            else:
                # TEXT, THINKING, ERROR, etc. — strip indicator and render normally
                strip_tool_indicator()
                rendered = formatter.format_emit(block_type, event.content, event.metadata)
                buffer += rendered
                current_block_id = None
                current_block_render_start = len(buffer)
                await split_if_needed()
                await flush()

        elif event.type in (PluginEventType.COMPLETE, PluginEventType.ERROR):
            strip_tool_indicator()
            final_event = event
            break

    # Final flush to ensure all buffered text is sent
    if buffer:
        await split_if_needed()
        await flush(force=True)

    # Post tool usage thread if any tools were used.
    # TODO: make this user-configurable (e.g. per-guild or per-user setting)
    _enable_tool_threads = False
    if _enable_tool_threads and tool_records:
        if not current_msg:
            current_msg = await channel.send("-# Done.")
        try:
            thread = await current_msg.create_thread(name="Tool Usage")
            for entry_text in formatter.format_tool_thread(tool_records):
                await thread.send(entry_text)
        except discord.HTTPException:
            log.warning("Failed to create tool usage thread")

    return final_event
