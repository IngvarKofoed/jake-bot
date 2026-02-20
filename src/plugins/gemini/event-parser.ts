import type { BotEvent } from "../../stream/events.js";
import { cleanToolName } from "../util.js";

export class GeminiEventParser {
  private blockSeq = 0;
  private textBlockId: string | null = null;
  private sessionId: string | undefined;

  constructor(initialSessionId?: string) {
    this.sessionId = initialSessionId;
  }

  private nextId(): string {
    return `b${this.blockSeq++}`;
  }

  private closeTextBlock(): BotEvent[] {
    if (!this.textBlockId) return [];
    const ev: BotEvent = {
      type: "block_close",
      pluginId: "gemini",
      ts: Date.now(),
      blockId: this.textBlockId,
    };
    this.textBlockId = null;
    return [ev];
  }

  pushLine(line: string): BotEvent[] {
    if (!line.trim()) return [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }

    const ts = Date.now();
    const events: BotEvent[] = [];

    switch (parsed.type) {
      case "init":
        this.sessionId = (parsed.session_id as string) ?? this.sessionId;
        break;

      case "message":
        if (parsed.role === "user") break;
        if (parsed.role === "assistant") {
          const content = parsed.content as string;
          if (!content) break;

          if (!this.textBlockId) {
            this.textBlockId = this.nextId();
            events.push({
              type: "block_open",
              pluginId: "gemini",
              ts,
              block: { id: this.textBlockId, kind: "text" },
            });
          }
          events.push({
            type: "block_delta",
            pluginId: "gemini",
            ts,
            blockId: this.textBlockId,
            delta: content,
          });
        }
        break;

      case "tool_use":
        events.push(...this.closeTextBlock());
        events.push({
          type: "block_emit",
          pluginId: "gemini",
          ts,
          block: {
            id: this.nextId(),
            kind: "tool_use",
            toolName: cleanToolName((parsed.tool_name as string) ?? "unknown"),
            toolId: (parsed.tool_id as string) ?? "",
            input: (parsed.parameters as Record<string, unknown>) ?? {},
          },
        });
        break;

      case "tool_result":
        events.push(...this.closeTextBlock());
        events.push({
          type: "block_emit",
          pluginId: "gemini",
          ts,
          block: {
            id: this.nextId(),
            kind: "tool_result",
            toolUseId: (parsed.tool_id as string) ?? "",
            isError: parsed.status === "error",
            content: {
              format: "text",
              text: (parsed.output as string) ?? "",
            },
          },
        });
        break;

      case "result":
        events.push(...this.closeTextBlock());
        events.push({
          type: "complete",
          pluginId: "gemini",
          ts,
          sessionId: this.sessionId,
          durationMs: (parsed.stats as Record<string, unknown>)?.duration_ms as
            | number
            | undefined,
        });
        break;
    }

    return events;
  }

  *finish(exitCode: number | null): Generator<BotEvent> {
    yield* this.closeTextBlock();
    // If no result event was emitted, the caller checks whether
    // a CompleteEvent was already yielded.
    if (exitCode !== 0 && exitCode !== null) {
      yield {
        type: "fatal_error",
        pluginId: "gemini",
        ts: Date.now(),
        error: { message: `Gemini CLI exited with code ${exitCode}` },
      };
    }
  }
}
