import { query } from "@anthropic-ai/claude-code";
import type { CliPlugin, ExecuteInput, PluginContext, ConversationInfo } from "../types.js";
import type { BotEvent } from "../../stream/events.js";
import { mapClaudeMessage } from "./event-mapper.js";

export class ClaudePlugin implements CliPlugin {
  readonly id = "claude";
  readonly displayName = "Claude Code";

  constructor(
    private readonly maxTurns = 30,
    private readonly maxBudgetUsd = 5.0,
  ) {}

  async *execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent> {
    const mcpEndpoint = ctx.mcpEndpoints.find((e) => e.name === "process-manager");

    const options = {
      permissionMode: "bypassPermissions" as const,
      maxTurns: this.maxTurns,
      maxBudgetUsd: this.maxBudgetUsd,
      cwd: input.workdir,
      settingSources: ["user", "project", "local"] as const,
      resume: input.sessionId,
      mcpServers: mcpEndpoint
        ? { "process-manager": { type: "http" as const, url: mcpEndpoint.url } }
        : undefined,
    };

    for await (const msg of query({ prompt: input.message, options })) {
      yield* mapClaudeMessage(msg as Parameters<typeof mapClaudeMessage>[0], "claude");
    }
  }

  async listConversations(): Promise<ConversationInfo[]> {
    // Walk ~/.claude/projects/*//*.jsonl
    return [];
  }
}
