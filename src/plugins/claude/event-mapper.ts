import type { BotEvent, ToolResultContent } from "../../stream/events.js";
import { cleanToolName } from "../util.js";

// Type guards for Claude SDK message types.
// We use structural checks rather than importing SDK types directly
// so the mapper stays testable without the SDK installed.

interface TextBlock {
  type: "text";
  text: string;
}
interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content: string | Array<{ type: string; text?: string }> | null | undefined;
}
interface AssistantMessage {
  type: "assistant";
  message: { content: ContentBlock[] };
}
interface ResultMessage {
  type: "result";
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
}

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;
type SdkMessage = AssistantMessage | ResultMessage | { type?: string };

let blockSeq = 0;
const nextId = () => `b${blockSeq++}`;

export function* mapClaudeMessage(
  msg: SdkMessage,
  pluginId: "claude",
): Generator<BotEvent> {
  const ts = Date.now();

  const content = extractContent(msg);
  if (content) {
    for (const block of content) {
      if (block.type === "text") {
        const id = nextId();
        yield { type: "block_open", pluginId, ts, block: { id, kind: "text" } };
        yield { type: "block_delta", pluginId, ts, blockId: id, delta: (block as TextBlock).text };
        yield { type: "block_close", pluginId, ts, blockId: id };
      }

      if (block.type === "thinking") {
        const id = nextId();
        yield { type: "block_open", pluginId, ts, block: { id, kind: "thinking" } };
        yield {
          type: "block_delta",
          pluginId,
          ts,
          blockId: id,
          delta: (block as ThinkingBlock).thinking,
        };
        yield { type: "block_close", pluginId, ts, blockId: id };
      }

      if (block.type === "tool_use") {
        const tu = block as ToolUseBlock;
        yield {
          type: "block_emit",
          pluginId,
          ts,
          block: {
            id: nextId(),
            kind: "tool_use",
            toolName: cleanToolName(tu.name),
            toolId: tu.id,
            input: tu.input,
          },
        };
      }

      if (block.type === "tool_result") {
        const tr = block as ToolResultBlock;
        yield {
          type: "block_emit",
          pluginId,
          ts,
          block: {
            id: nextId(),
            kind: "tool_result",
            toolUseId: tr.tool_use_id,
            isError: tr.is_error ?? false,
            content: normalizeToolResultContent(tr.content),
          },
        };
      }
    }
  }

  if (isResultMessage(msg)) {
    yield {
      type: "complete",
      pluginId,
      ts,
      sessionId: msg.session_id,
      costUsd: msg.total_cost_usd,
      durationMs: msg.duration_ms,
    };
  }
}

function normalizeToolResultContent(
  raw: string | Array<{ type: string; text?: string }> | null | undefined,
): ToolResultContent {
  if (raw == null) return { format: "empty" };
  if (typeof raw === "string") return { format: "text", text: raw };
  if (Array.isArray(raw)) {
    const parts = raw
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof p.text === "string",
      )
      .map((p) => ({ type: "text" as const, text: p.text }));
    return parts.length > 0 ? { format: "parts", parts } : { format: "empty" };
  }
  return { format: "empty" };
}

function extractContent(m: SdkMessage): ContentBlock[] | undefined {
  // SDKAssistantMessage: { type: 'assistant', message: { content: [...] } }
  if (
    (m as AssistantMessage).type === "assistant" &&
    Array.isArray((m as AssistantMessage).message?.content)
  ) {
    return (m as AssistantMessage).message.content;
  }
  return undefined;
}

function isResultMessage(m: unknown): m is ResultMessage {
  return (m as ResultMessage)?.type === "result";
}
