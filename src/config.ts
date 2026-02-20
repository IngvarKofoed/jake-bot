import { homedir } from "node:os";
import "dotenv/config";

export interface BotConfig {
  /** Discord bot token. */
  discordToken: string;
  /** Discord application ID (for registering slash commands). */
  discordAppId: string;
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
}

export function loadConfig(): BotConfig {
  const port = parseInt(process.env.PROCESS_MANAGER_PORT ?? "8901", 10);

  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordAppId: requireEnv("DISCORD_APP_ID"),
    defaultWorkdir: process.env.DEFAULT_WORKDIR ?? homedir(),
    processManagerPort: port,
    processManagerUrl: process.env.PROCESS_MANAGER_URL ?? `http://localhost:${port}/mcp`,
    claudeMaxTurns: parseInt(process.env.CLAUDE_MAX_TURNS ?? "30", 10),
    claudeMaxBudget: parseFloat(process.env.CLAUDE_MAX_BUDGET ?? "5.0"),
    geminiBin: process.env.GEMINI_BIN ?? "gemini",
  };
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
