/**
 * Discord inbound adapter.
 *
 * Owns the discord.js Client, slash command definitions, command handlers,
 * and event listeners. Receives platform-agnostic core deps via constructor.
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import type { BotConfig } from "../config.js";
import type { PluginRegistry } from "../core/plugin-registry.js";
import type { ActiveConversations } from "../core/active-conversations.js";
import { Router } from "../core/router.js";
import { DiscordPlatform } from "../platform/discord.js";
import { DiscordRenderer } from "../rendering/discord-renderer.js";
import type { PluginContext } from "../plugins/types.js";
import type { BotAdapter } from "./types.js";
import { log } from "../core/logger.js";

export class DiscordAdapter implements BotAdapter {
  private readonly client: Client;
  private readonly platform: DiscordPlatform;
  private readonly router: Router;

  constructor(
    private readonly config: BotConfig,
    private readonly plugins: PluginRegistry,
    private readonly conversations: ActiveConversations,
    ctx: PluginContext,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.platform = new DiscordPlatform(this.client);
    const renderer = new DiscordRenderer();
    this.router = new Router(plugins, conversations, this.platform, renderer, ctx);

    this.registerEventListeners();
  }

  async start(): Promise<void> {
    await this.registerCommands();
    await this.client.login(this.config.discordToken);
  }

  // -- Slash command definitions --

  private get commands() {
    return [
      new SlashCommandBuilder()
        .setName("claude")
        .setDescription("Start a Claude Code conversation")
        .addStringOption((o) =>
          o.setName("workdir").setDescription("Working directory"),
        ),

      new SlashCommandBuilder()
        .setName("gemini")
        .setDescription("Start a Gemini conversation")
        .addStringOption((o) =>
          o.setName("workdir").setDescription("Working directory"),
        ),

      new SlashCommandBuilder()
        .setName("codex")
        .setDescription("Start a Codex conversation")
        .addStringOption((o) =>
          o.setName("workdir").setDescription("Working directory"),
        ),

      new SlashCommandBuilder()
        .setName("end")
        .setDescription("End the current conversation"),

      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show current conversation status"),

      new SlashCommandBuilder()
        .setName("conversations")
        .setDescription("List all active conversations"),

      new SlashCommandBuilder()
        .setName("resume")
        .setDescription("Resume a previous conversation")
        .addStringOption((o) =>
          o.setName("plugin").setDescription("Plugin (claude/gemini/codex)").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("session_id").setDescription("Session ID to resume").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("workdir").setDescription("Working directory"),
        ),
    ];
  }

  // -- Register slash commands on startup --

  private async registerCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(this.config.discordToken);
    await rest.put(Routes.applicationCommands(this.config.discordAppId), {
      body: this.commands.map((c) => c.toJSON()),
    });
    log.info("bot", "Slash commands registered");
  }

  // -- Event listeners --

  private registerEventListeners(): void {
    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      try {
        switch (interaction.commandName) {
          case "claude":
            await this.handleStartCommand(interaction, "claude");
            break;
          case "gemini":
            await this.handleStartCommand(interaction, "gemini");
            break;
          case "codex":
            await this.handleStartCommand(interaction, "codex");
            break;
          case "end":
            await this.handleEnd(interaction);
            break;
          case "status":
            await this.handleStatus(interaction);
            break;
          case "conversations":
            await this.handleConversations(interaction);
            break;
          case "resume":
            await this.handleResume(interaction);
            break;
        }
      } catch (err) {
        log.error("bot", `Command error: ${err instanceof Error ? err.message : String(err)}`);
        const reply = interaction.deferred || interaction.replied
          ? interaction.followUp.bind(interaction)
          : interaction.reply.bind(interaction);
        await reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
      }
    });

    // Follow-up messages in active conversations
    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;
      const convo = this.conversations.get(message.author.id, message.channelId);
      if (!convo) return;

      try {
        await this.router.route(message.author.id, message.channelId, message.content);
      } catch (err) {
        log.error("router", `Message routing error: ${err instanceof Error ? err.message : String(err)}`);
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.platform.send(message.channelId, {
          text: `\u274C Error: ${errMsg}`,
          parseMode: "plain",
        });
      }
    });

    this.client.once("ready", () => {
      log.info("bot", `Logged in as ${this.client.user?.tag}`);
    });
  }

  // -- Command handlers --

  private async handleStartCommand(
    interaction: ChatInputCommandInteraction,
    pluginId: string,
  ): Promise<void> {
    const workdir = interaction.options.getString("workdir") ?? this.config.defaultWorkdir;
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    try {
      this.conversations.start(userId, channelId, pluginId, workdir);
    } catch (err) {
      await interaction.reply({ content: (err as Error).message, ephemeral: true });
      return;
    }

    const plugin = this.plugins.require(pluginId);
    await interaction.reply(`Started ${plugin.displayName} conversation. Send a message to begin.`);
  }

  private async handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
    const ended = this.conversations.end(interaction.user.id, interaction.channelId);
    await interaction.reply(
      ended ? "Conversation ended." : "No active conversation.",
    );
  }

  private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const convo = this.conversations.get(interaction.user.id, interaction.channelId);
    if (!convo) {
      await interaction.reply({ content: "No active conversation.", ephemeral: true });
      return;
    }
    const plugin = this.plugins.get(convo.pluginId);
    const lines = [
      `**Plugin:** ${plugin?.displayName ?? convo.pluginId}`,
      `**Working dir:** \`${convo.workdir}\``,
      convo.sessionId ? `**Session:** \`${convo.sessionId}\`` : null,
      `**Started:** <t:${Math.floor(convo.startedAt / 1000)}:R>`,
    ].filter(Boolean);
    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
  }

  private async handleConversations(interaction: ChatInputCommandInteraction): Promise<void> {
    const all = this.conversations.listAll();
    if (all.length === 0) {
      await interaction.reply({ content: "No active conversations.", ephemeral: true });
      return;
    }
    const lines = all.map(({ userId, channelId, conversation: c }) => {
      const plugin = this.plugins.get(c.pluginId);
      return `<@${userId}> in <#${channelId}> — **${plugin?.displayName ?? c.pluginId}**`;
    });
    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
  }

  private async handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
    const pluginId = interaction.options.getString("plugin", true);
    const sessionId = interaction.options.getString("session_id", true);
    const workdir = interaction.options.getString("workdir") ?? this.config.defaultWorkdir;
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (!this.plugins.get(pluginId)) {
      await interaction.reply({ content: `Unknown plugin: ${pluginId}`, ephemeral: true });
      return;
    }

    try {
      this.conversations.resume(userId, channelId, pluginId, workdir, sessionId);
    } catch (err) {
      await interaction.reply({ content: (err as Error).message, ephemeral: true });
      return;
    }

    const plugin = this.plugins.require(pluginId);
    await interaction.reply(`Resuming ${plugin.displayName} session \`${sessionId}\`...`);
  }
}
