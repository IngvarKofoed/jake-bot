from __future__ import annotations

import logging
import re
import time
from collections.abc import AsyncIterator

import discord

from .models import PluginEvent, PluginEventType

log = logging.getLogger(__name__)

DISCORD_CHAR_LIMIT = 1900
MIN_EDIT_INTERVAL = 0.5  # seconds — ~2 edits/sec to stay under rate limits

# Match bare URLs (not already inside <angle brackets>)
_BARE_URL_RE = re.compile(r"(?<![<(])(https?://\S+)")


def _suppress_embeds(text: str) -> str:
    """Wrap bare URLs in <brackets> so Discord won't generate previews."""
    return _BARE_URL_RE.sub(r"<\1>", text)


def _unclosed_code_fence(text: str) -> str | None:
    """If text has an unclosed ``` block, return the fence line (e.g. '```json').

    Returns None if all code blocks are properly closed.
    """
    fence = None
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            if fence is None:
                # Opening fence — remember it (e.g. "```json", "```")
                fence = stripped
            else:
                # Closing fence
                fence = None
    return fence


async def stream_to_discord(
    events: AsyncIterator[PluginEvent],
    channel: discord.abc.Messageable,
) -> PluginEvent | None:
    """Consume plugin events and stream them into Discord messages.

    Returns the final COMPLETE or ERROR event, or None if the stream
    ended without one.
    """
    buffer = ""
    current_msg: discord.Message | None = None
    last_edit = 0.0
    final_event: PluginEvent | None = None

    async def flush(force: bool = False) -> None:
        nonlocal current_msg, last_edit, buffer
        now = time.monotonic()
        if not force and (now - last_edit) < MIN_EDIT_INTERVAL:
            return
        if not buffer:
            return

        text = _suppress_embeds(buffer[:DISCORD_CHAR_LIMIT])
        if current_msg is None:
            current_msg = await channel.send(text)
        else:
            try:
                await current_msg.edit(content=text)
            except discord.HTTPException:
                log.warning("Failed to edit message, sending new one")
                current_msg = await channel.send(text)
        last_edit = time.monotonic()

    async for event in events:
        if event.type == PluginEventType.TEXT_DELTA:
            buffer += event.content

            # If buffer exceeds limit, finalize current message and start new
            if len(buffer) > DISCORD_CHAR_LIMIT:
                overflow = buffer[DISCORD_CHAR_LIMIT:]
                buffer = buffer[:DISCORD_CHAR_LIMIT]
                # Close unclosed code fence before splitting
                fence = _unclosed_code_fence(buffer)
                if fence:
                    buffer += "\n```"
                await flush(force=True)
                # Reopen the code fence in the next message
                current_msg = None
                buffer = (fence + "\n" + overflow) if fence else overflow

            await flush()

        elif event.type == PluginEventType.STATUS:
            # Show tool usage as small text
            status_line = f"\n-# {event.content}...\n"
            buffer += status_line
            await flush()

        elif event.type in (PluginEventType.COMPLETE, PluginEventType.ERROR):
            final_event = event
            break

    # Final flush to ensure all buffered text is sent
    if buffer:
        await flush(force=True)

    return final_event
