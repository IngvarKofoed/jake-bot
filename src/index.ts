/**
 * jake-bot entry point.
 *
 * Wires platform-agnostic core objects and starts the selected adapter(s).
 */

import { loadConfig } from "./config.js";
import { PluginRegistry } from "./core/plugin-registry.js";
import { ActiveConversations } from "./core/active-conversations.js";
import { CommandRegistry, registerStandardCommands } from "./core/command-registry.js";
import { ClaudePlugin } from "./plugins/claude/plugin.js";
import { GeminiPlugin } from "./plugins/gemini/plugin.js";
import type { PluginContext } from "./plugins/types.js";
import type { BotAdapter } from "./adapters/types.js";
import { log } from "./core/logger.js";

const config = loadConfig();

// -- Plugin registry --

const plugins = new PluginRegistry();
plugins.register(new ClaudePlugin(config.claudeMaxTurns, config.claudeMaxBudget));
plugins.register(new GeminiPlugin(config.geminiBin));

// -- Command registry --

const commandRegistry = new CommandRegistry();
registerStandardCommands(commandRegistry);

// -- Shared context --

const ctx: PluginContext = {
  mcpEndpoints: [{ name: "process-manager", url: config.processManagerUrl }],
  logger: log,
};

// -- Start adapter(s) --

const conversations = new ActiveConversations(config.sessionsFile || undefined);
const adapters: BotAdapter[] = [];

if (config.adapter === "discord" || config.adapter === "both") {
  const { DiscordAdapter } = await import("./adapters/discord.js");
  adapters.push(new DiscordAdapter(config, plugins, conversations, ctx, commandRegistry));
}

if (config.adapter === "web" || config.adapter === "both") {
  const { WebAdapter } = await import("./adapters/web.js");
  adapters.push(new WebAdapter(config, plugins, conversations, ctx, commandRegistry));
}

if (adapters.length === 0) {
  log.error("bot", `Unknown adapter: ${config.adapter}. Use "discord", "web", or "both".`);
  process.exit(1);
}

await Promise.all(
  adapters.map((a) =>
    a.start().catch((err) => {
      log.error("bot", `Fatal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }),
  ),
);
