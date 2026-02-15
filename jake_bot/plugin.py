from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from .models import ConversationInfo, PluginEvent


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
