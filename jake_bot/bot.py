from __future__ import annotations

import logging

import discord
from discord import app_commands

from .active_conversations import ActiveConversations
from .claude_plugin import ClaudeCodePlugin
from .config import Config
from .models import ActiveConversation
from .stream_coordinator import stream_to_discord

log = logging.getLogger(__name__)


class JakeBot(discord.Client):
    def __init__(self, config: Config) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)

        self.config = config
        self.tree = app_commands.CommandTree(self)
        self.conversations = ActiveConversations()
        self.claude = ClaudeCodePlugin()

        self._register_commands()

    def _is_allowed(self, user_id: int) -> bool:
        return user_id in self.config.allowed_user_ids

    def _register_commands(self) -> None:
        @self.tree.command(name="claude", description="Start a new Claude Code conversation")
        @app_commands.describe(workdir="Working directory for Claude (default: home)")
        async def cmd_claude(interaction: discord.Interaction, workdir: str | None = None):
            if not self._is_allowed(interaction.user.id):
                await interaction.response.send_message("Not authorized.", ephemeral=True)
                return

            wd = workdir or self.config.default_workdir
            conv = ActiveConversation(
                plugin_id=self.claude.plugin_id,
                workdir=wd,
            )
            self.conversations.set(interaction.user.id, interaction.channel_id, conv)
            await interaction.response.send_message(
                f"Started Claude Code conversation.\nWorkdir: `{wd}`\n"
                f"Send messages in this channel to talk to Claude. Use `/end` to stop."
            )

        @self.tree.command(name="end", description="End your active conversation")
        async def cmd_end(interaction: discord.Interaction):
            if not self._is_allowed(interaction.user.id):
                await interaction.response.send_message("Not authorized.", ephemeral=True)
                return

            removed = self.conversations.remove(interaction.user.id, interaction.channel_id)
            if removed:
                await interaction.response.send_message("Conversation ended.")
            else:
                await interaction.response.send_message("No active conversation in this channel.", ephemeral=True)

        @self.tree.command(name="status", description="Show active conversation info")
        async def cmd_status(interaction: discord.Interaction):
            if not self._is_allowed(interaction.user.id):
                await interaction.response.send_message("Not authorized.", ephemeral=True)
                return

            conv = self.conversations.get(interaction.user.id, interaction.channel_id)
            if not conv:
                await interaction.response.send_message("No active conversation.", ephemeral=True)
                return

            lines = [
                f"**Plugin:** {conv.plugin_id}",
                f"**Workdir:** `{conv.workdir}`",
                f"**Session:** `{conv.session_id or 'not yet assigned'}`",
            ]
            await interaction.response.send_message("\n".join(lines))

        @self.tree.command(name="conversations", description="List past Claude conversations")
        async def cmd_conversations(interaction: discord.Interaction):
            if not self._is_allowed(interaction.user.id):
                await interaction.response.send_message("Not authorized.", ephemeral=True)
                return

            await interaction.response.defer()
            convos = await self.claude.list_conversations()
            if not convos:
                await interaction.followup.send("No past conversations found.")
                return

            lines = []
            for c in convos[:15]:
                ts = c.timestamp.strftime("%Y-%m-%d %H:%M")
                lines.append(f"`{c.id[:12]}` — {c.title} ({ts})")
            await interaction.followup.send("\n".join(lines))

        @self.tree.command(name="resume", description="Resume a past conversation")
        @app_commands.describe(
            session_id="Session ID to resume",
            workdir="Working directory (default: home)",
        )
        async def cmd_resume(
            interaction: discord.Interaction,
            session_id: str,
            workdir: str | None = None,
        ):
            if not self._is_allowed(interaction.user.id):
                await interaction.response.send_message("Not authorized.", ephemeral=True)
                return

            wd = workdir or self.config.default_workdir
            conv = ActiveConversation(
                plugin_id=self.claude.plugin_id,
                workdir=wd,
                session_id=session_id,
            )
            self.conversations.set(interaction.user.id, interaction.channel_id, conv)
            await interaction.response.send_message(
                f"Resumed conversation `{session_id[:12]}...`\n"
                f"Workdir: `{wd}`\nSend messages to continue."
            )

    async def on_ready(self) -> None:
        await self.tree.sync()
        log.info("Logged in as %s (ID: %s)", self.user, self.user.id)
        log.info("Synced slash commands")
        log.info("Allowed users: %s", self.config.allowed_user_ids)

    async def on_message(self, message: discord.Message) -> None:
        # Ignore own messages and bots
        if message.author.bot:
            return
        if not self._is_allowed(message.author.id):
            return

        conv = self.conversations.get(message.author.id, message.channel.id)
        if not conv:
            return

        # Route plain text to the active plugin
        async with message.channel.typing():
            events = self.claude.execute(
                workdir=conv.workdir,
                message=message.content,
                session_id=conv.session_id,
            )
            final = await stream_to_discord(events, message.channel)

        if final and final.session_id:
            self.conversations.update_session_id(
                message.author.id, message.channel.id, final.session_id
            )

        # Show cost/duration footer
        if final and final.cost_usd is not None:
            cost = f"${final.cost_usd:.4f}"
            duration = f"{final.duration_ms / 1000:.1f}s" if final.duration_ms else "?"
            await message.channel.send(f"-# Cost: {cost} | Duration: {duration}")

        if final and final.type.value == "error":
            await message.channel.send(f"Error: {final.content}")
