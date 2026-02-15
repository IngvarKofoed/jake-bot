from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


# ---------------------------------------------------------------------------
# ResponseBlock types — the semantic content types a plugin can emit
# ---------------------------------------------------------------------------

class ResponseBlockType(enum.Enum):
    TEXT = "text"                # plain text / markdown
    THINKING = "thinking"       # model reasoning (extended thinking)
    TOOL_USE = "tool_use"       # tool invocation announcement
    TOOL_RESULT = "tool_result" # output returned by a tool
    ERROR = "error"             # error message
    SYSTEM = "system"           # system-level notification


# ---------------------------------------------------------------------------
# PluginEvent — the streaming envelope emitted by plugins
# ---------------------------------------------------------------------------

class PluginEventType(enum.Enum):
    # Block lifecycle (streaming)
    BLOCK_OPEN = "block_open"    # new block started — includes block_type + metadata
    BLOCK_DELTA = "block_delta"  # append content to an open block
    BLOCK_CLOSE = "block_close"  # block finished
    # One-shot block (arrives complete)
    BLOCK_EMIT = "block_emit"    # complete block in a single event
    # Conversation lifecycle
    COMPLETE = "complete"        # turn finished — includes session_id, cost, duration
    ERROR = "error"              # fatal error


@dataclass
class PluginEvent:
    type: PluginEventType
    content: str = ""
    block_id: str | None = None
    block_type: ResponseBlockType | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    # Only set on COMPLETE / ERROR events:
    session_id: str | None = None
    cost_usd: float | None = None
    duration_ms: int | None = None


# ---------------------------------------------------------------------------
# Conversation models (unchanged)
# ---------------------------------------------------------------------------

@dataclass
class ActiveConversation:
    plugin_id: str
    workdir: str
    session_id: str | None = None


@dataclass
class ConversationInfo:
    id: str
    title: str
    timestamp: datetime
    project: str = ""
