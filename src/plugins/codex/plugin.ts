import type { CliPlugin, ExecuteInput, PluginContext, ConversationInfo } from "../types.js";
import type { BotEvent } from "../../stream/events.js";
import { mapCodexEvent, type CodexSdkEvent } from "./event-mapper.js";

/** Codex SDK client interface (hypothetical -- adapt to actual SDK). */
export interface CodexClient {
  runTurn(input: {
    workdir: string;
    prompt: string;
    sessionId?: string;
  }): AsyncIterable<CodexSdkEvent>;
  listSessions(
    workdir?: string,
  ): Promise<Array<{ id: string; title: string; updatedAt: string }>>;
}

export class CodexPlugin implements CliPlugin {
  readonly id = "codex";
  readonly displayName = "Codex";

  constructor(private readonly client: CodexClient) {}

  async *execute(
    input: ExecuteInput,
    _ctx: PluginContext,
  ): AsyncGenerator<BotEvent> {
    for await (const sdkEvent of this.client.runTurn({
      workdir: input.workdir,
      prompt: input.message,
      sessionId: input.sessionId,
    })) {
      yield mapCodexEvent(sdkEvent);
    }
  }

  async listConversations(workdir?: string): Promise<ConversationInfo[]> {
    const sessions = await this.client.listSessions(workdir);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      timestamp: new Date(s.updatedAt),
    }));
  }
}
