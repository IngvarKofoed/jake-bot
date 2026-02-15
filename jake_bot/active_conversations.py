from __future__ import annotations

from .models import ActiveConversation


class ActiveConversations:
    """In-memory store of (user_id, channel_id) -> ActiveConversation.

    Lost on reboot by design — conversation history lives on disk via
    the CLI's own session files.
    """

    def __init__(self) -> None:
        self._store: dict[tuple[int, int], ActiveConversation] = {}

    def get(self, user_id: int, channel_id: int) -> ActiveConversation | None:
        return self._store.get((user_id, channel_id))

    def set(self, user_id: int, channel_id: int, conv: ActiveConversation) -> None:
        self._store[(user_id, channel_id)] = conv

    def remove(self, user_id: int, channel_id: int) -> bool:
        return self._store.pop((user_id, channel_id), None) is not None

    def update_session_id(
        self, user_id: int, channel_id: int, session_id: str
    ) -> None:
        conv = self._store.get((user_id, channel_id))
        if conv:
            conv.session_id = session_id
