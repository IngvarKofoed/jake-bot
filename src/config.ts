import { homedir } from "node:os";
import "dotenv/config";

export type Adapter = "discord" | "web" | "both";

export interface BotConfig {
  /** Which adapter(s) to start. */
  adapter: Adapter;
  /** Discord bot token (required when adapter includes discord). */
  discordToken: string | undefined;
  /** Discord application ID (required when adapter includes discord). */
  discordAppId: string | undefined;
  /** Default working directory for CLI plugins. */
  defaultWorkdir: string;
  /** Process manager MCP server port. */
  processManagerPort: number;
  /** Process manager MCP server URL. */
  processManagerUrl: string;
  /** Claude plugin max turns per invocation. */
  claudeMaxTurns: number;
  /** Claude plugin max budget per invocation (USD). */
  claudeMaxBudget: number;
  /** Gemini CLI binary path. */
  geminiBin: string;
  /** Web adapter HTTP port. */
  webPort: number;
  /** Default plugin for the web adapter (auto-starts if no active conversation). */
  defaultPlugin: string;
  /** Google API key for Cloud TTS (optional — disables server TTS when absent). */
  googleApiKey: string | undefined;
}

export function loadConfig(): BotConfig {
  const port = parseInt(process.env.PROCESS_MANAGER_PORT ?? "8901", 10);
  const adapter = (process.env.ADAPTER ?? "discord") as Adapter;

  return {
    adapter,
    discordToken: process.env.DISCORD_TOKEN,
    discordAppId: process.env.DISCORD_APP_ID,
    defaultWorkdir: process.env.DEFAULT_WORKDIR ?? homedir(),
    processManagerPort: port,
    processManagerUrl: process.env.PROCESS_MANAGER_URL ?? `http://localhost:${port}/mcp`,
    claudeMaxTurns: parseInt(process.env.CLAUDE_MAX_TURNS ?? "30", 10),
    claudeMaxBudget: parseFloat(process.env.CLAUDE_MAX_BUDGET ?? "5.0"),
    geminiBin: process.env.GEMINI_BIN ?? "gemini",
    webPort: parseInt(process.env.WEB_PORT ?? "3000", 10),
    defaultPlugin: process.env.DEFAULT_PLUGIN ?? "claude",
    googleApiKey: process.env.GOOGLE_API_KEY,
  };
}

