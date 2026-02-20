/**
 * jake-bot entry point.
 *
 * Wires platform-agnostic core objects and starts the adapter.
 */

import { loadConfig } from "./config.js";
import { PluginRegistry } from "./core/plugin-registry.js";
import { ActiveConversations } from "./core/active-conversations.js";
import { ClaudePlugin } from "./plugins/claude/plugin.js";
import { GeminiPlugin } from "./plugins/gemini/plugin.js";
import { DiscordAdapter } from "./adapters/discord.js";
import type { PluginContext } from "./plugins/types.js";
import { log } from "./core/logger.js";

const config = loadConfig();

// -- Plugin registry --

const plugins = new PluginRegistry();
plugins.register(new ClaudePlugin(config.claudeMaxTurns, config.claudeMaxBudget));
plugins.register(new GeminiPlugin(config.geminiBin));

// -- Shared context --

const ctx: PluginContext = {
  mcpEndpoints: [{ name: "process-manager", url: config.processManagerUrl }],
  logger: log,
};

// -- Start --

const conversations = new ActiveConversations();
const adapter = new DiscordAdapter(config, plugins, conversations, ctx);

adapter.start().catch((err) => {
  log.error("bot", `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
