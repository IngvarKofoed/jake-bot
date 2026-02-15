from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    discord_token: str
    allowed_user_ids: set[int]
    base_workdir: str = str(Path.home())

    def resolve_workdir(self, relative: str | None = None) -> str:
        """Resolve a user-provided path relative to base_workdir.

        /claude data/jake-bot  ->  ~/data/jake-bot  ->  /Users/.../data/jake-bot
        /claude                ->  ~                 ->  /Users/...
        /claude /tmp/foo       ->  /tmp/foo          (absolute paths used as-is)
        """
        base = Path(self.base_workdir)
        if not relative:
            return str(base.resolve())
        rel = Path(relative)
        if rel.is_absolute():
            return str(rel.resolve())
        return str((base / rel).resolve())

    @classmethod
    def from_env(cls, env_path: str | Path | None = None) -> Config:
        load_dotenv(env_path)

        token = os.environ["DISCORD_BOT_TOKEN"]

        raw_ids = os.getenv("ALLOWED_USER_IDS", "")
        allowed = {int(uid.strip()) for uid in raw_ids.split(",") if uid.strip()}

        base = os.getenv("BASE_WORKDIR", str(Path.home()))

        return cls(
            discord_token=token,
            allowed_user_ids=allowed,
            base_workdir=base,
        )
