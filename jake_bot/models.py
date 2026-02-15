from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime


class PluginEventType(enum.Enum):
    TEXT_DELTA = "text_delta"
    STATUS = "status"
    ERROR = "error"
    COMPLETE = "complete"


@dataclass
class PluginEvent:
    type: PluginEventType
    content: str = ""
    metadata: dict = field(default_factory=dict)
    session_id: str | None = None
    cost_usd: float | None = None
    duration_ms: int | None = None


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
