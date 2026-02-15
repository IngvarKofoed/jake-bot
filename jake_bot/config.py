from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    discord_token: str
    allowed_user_ids: set[int]
    default_workdir: str = str(Path.home())

    @classmethod
    def from_env(cls, env_path: str | Path | None = None) -> Config:
        load_dotenv(env_path)

        token = os.environ["DISCORD_BOT_TOKEN"]

        raw_ids = os.getenv("ALLOWED_USER_IDS", "")
        allowed = {int(uid.strip()) for uid in raw_ids.split(",") if uid.strip()}

        workdir = os.getenv("DEFAULT_WORKDIR", str(Path.home()))

        return cls(
            discord_token=token,
            allowed_user_ids=allowed,
            default_workdir=workdir,
        )
