/**
 * jake-bot Discord entry point.
 *
 * Registers slash commands and routes messages through the plugin system.
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
import { loadConfig } from "./config.js";
import { PluginRegistry } from "./core/plugin-registry.js";
import { ActiveConversations } from "./core/active-conversations.js";
import { Router } from "./core/router.js";
import { ClaudePlugin } from "./plugins/claude/plugin.js";
import { GeminiPlugin } from "./plugins/gemini/plugin.js";
import { DiscordPlatform } from "./platform/discord.js";
import { DiscordRenderer } from "./rendering/discord-renderer.js";
import type { PluginContext } from "./plugins/types.js";
import { log } from "./core/logger.js";

const config = loadConfig();

// -- Plugin registry --

const plugins = new PluginRegistry();
plugins.register(new ClaudePlugin(config.claudeMaxTurns, config.claudeMaxBudget));
plugins.register(new GeminiPlugin(config.geminiBin));
// CodexPlugin requires a client instance -- register when SDK is available

// -- Shared context --

const ctx: PluginContext = {
  mcpEndpoints: [{ name: "process-manager", url: config.processManagerUrl }],
  logger: log,
};

// -- Discord client --

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const platform = new DiscordPlatform(client);
const renderer = new DiscordRenderer();
const conversations = new ActiveConversations();
const router = new Router(plugins, conversations, platform, renderer, ctx);

// -- Slash command definitions --

const commands = [
  new SlashCommandBuilder()
    .setName("claude")
    .setDescription("Start a Claude Code conversation")
    .addStringOption((o) =>
      o.setName("message").setDescription("Initial message").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("workdir").setDescription("Working directory"),
    ),

  new SlashCommandBuilder()
    .setName("gemini")
    .setDescription("Start a Gemini conversation")
    .addStringOption((o) =>
      o.setName("message").setDescription("Initial message").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("workdir").setDescription("Working directory"),
    ),

  new SlashCommandBuilder()
    .setName("codex")
    .setDescription("Start a Codex conversation")
    .addStringOption((o) =>
      o.setName("message").setDescription("Initial message").setRequired(true),
    )
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

// -- Register slash commands on startup --

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  await rest.put(Routes.applicationCommands(config.discordAppId), {
    body: commands.map((c) => c.toJSON()),
  });
  log.info("bot", "Slash commands registered");
}

// -- Command handlers --

async function handleStartCommand(
  interaction: ChatInputCommandInteraction,
  pluginId: string,
) {
  const message = interaction.options.getString("message", true);
  const workdir = interaction.options.getString("workdir") ?? config.defaultWorkdir;
  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  try {
    conversations.start(userId, channelId, pluginId, workdir);
  } catch (err) {
    await interaction.reply({ content: (err as Error).message, ephemeral: true });
    return;
  }

  const plugin = plugins.require(pluginId);
  await interaction.reply(`Starting ${plugin.displayName} conversation...`);

  try {
    await router.route(userId, channelId, message);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await platform.send(channelId, {
      text: `\u274C Failed: ${errMsg}`,
      parseMode: "plain",
    });
    conversations.end(userId, channelId);
  }
}

async function handleEnd(interaction: ChatInputCommandInteraction) {
  const ended = conversations.end(interaction.user.id, interaction.channelId);
  await interaction.reply(
    ended ? "Conversation ended." : "No active conversation.",
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const convo = conversations.get(interaction.user.id, interaction.channelId);
  if (!convo) {
    await interaction.reply({ content: "No active conversation.", ephemeral: true });
    return;
  }
  const plugin = plugins.get(convo.pluginId);
  const lines = [
    `**Plugin:** ${plugin?.displayName ?? convo.pluginId}`,
    `**Working dir:** \`${convo.workdir}\``,
    convo.sessionId ? `**Session:** \`${convo.sessionId}\`` : null,
    `**Started:** <t:${Math.floor(convo.startedAt / 1000)}:R>`,
  ].filter(Boolean);
  await interaction.reply({ content: lines.join("\n"), ephemeral: true });
}

async function handleConversations(interaction: ChatInputCommandInteraction) {
  const all = conversations.listAll();
  if (all.length === 0) {
    await interaction.reply({ content: "No active conversations.", ephemeral: true });
    return;
  }
  const lines = all.map(({ userId, channelId, conversation: c }) => {
    const plugin = plugins.get(c.pluginId);
    return `<@${userId}> in <#${channelId}> — **${plugin?.displayName ?? c.pluginId}**`;
  });
  await interaction.reply({ content: lines.join("\n"), ephemeral: true });
}

async function handleResume(interaction: ChatInputCommandInteraction) {
  const pluginId = interaction.options.getString("plugin", true);
  const sessionId = interaction.options.getString("session_id", true);
  const workdir = interaction.options.getString("workdir") ?? config.defaultWorkdir;
  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  if (!plugins.get(pluginId)) {
    await interaction.reply({ content: `Unknown plugin: ${pluginId}`, ephemeral: true });
    return;
  }

  try {
    conversations.resume(userId, channelId, pluginId, workdir, sessionId);
  } catch (err) {
    await interaction.reply({ content: (err as Error).message, ephemeral: true });
    return;
  }

  const plugin = plugins.require(pluginId);
  await interaction.reply(`Resuming ${plugin.displayName} session \`${sessionId}\`...`);
}

// -- Event handlers --

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "claude":
        await handleStartCommand(interaction, "claude");
        break;
      case "gemini":
        await handleStartCommand(interaction, "gemini");
        break;
      case "codex":
        await handleStartCommand(interaction, "codex");
        break;
      case "end":
        await handleEnd(interaction);
        break;
      case "status":
        await handleStatus(interaction);
        break;
      case "conversations":
        await handleConversations(interaction);
        break;
      case "resume":
        await handleResume(interaction);
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
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  const convo = conversations.get(message.author.id, message.channelId);
  if (!convo) return;

  try {
    await router.route(message.author.id, message.channelId, message.content);
  } catch (err) {
    log.error("router", `Message routing error: ${err instanceof Error ? err.message : String(err)}`);
    const errMsg = err instanceof Error ? err.message : String(err);
    await platform.send(message.channelId, {
      text: `\u274C Error: ${errMsg}`,
      parseMode: "plain",
    });
  }
});

// -- Startup --

client.once("ready", () => {
  log.info("bot", `Logged in as ${client.user?.tag}`);
});

async function main() {
  await registerCommands();
  await client.login(config.discordToken);
}

main().catch((err) => {
  log.error("bot", `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
