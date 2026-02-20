import type { BotEvent } from "../stream/events.js";

export interface ConversationInfo {
  id: string;
  title: string;
  timestamp: Date;
  project?: string;
}

export interface ExecuteInput {
  workdir: string;
  message: string;
  sessionId?: string;
}

/**
 * Context injected into every plugin invocation.
 * Plugins never import globals -- everything comes through here.
 */
export interface PluginContext {
  mcpEndpoints: ReadonlyArray<{ name: string; url: string }>;
  logger: Pick<Console, "info" | "warn" | "error">;
}

/**
 * A CLI plugin knows how to invoke a specific AI CLI and translate
 * its output into the BotEvent stream.
 */
export interface CliPlugin {
  readonly id: string;
  readonly displayName: string;

  /**
   * Execute a single turn. Returns an async generator of BotEvents.
   * The generator completes when the CLI turn finishes.
   */
  execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent, void, void>;

  /** Best-effort listing of past conversations from the CLI. */
  listConversations(workdir?: string): Promise<ConversationInfo[]>;
}
