import type { BotEvent, ToolResultContent, InputRequestEvent, InputRequestOption, ModeChangeEvent } from "../../stream/events.js";
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

/**
 * Create a per-invocation Claude message mapper with its own block ID counter.
 * Call once per `execute()` invocation to avoid cross-invocation ID collisions.
 */
export function createClaudeMapper(pluginId: "claude") {
  let blockSeq = 0;
  const nextId = () => `claude_b${blockSeq++}`;

  return function* mapClaudeMessage(msg: SdkMessage): Generator<BotEvent> {
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
          const mapped = mapSpecialTool(tu, pluginId, ts, nextId);
          if (mapped) {
            for (const ev of mapped) yield ev;
          } else {
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
  };
}

/**
 * Map Claude-specific interactive tools to platform-agnostic events.
 * Returns undefined for regular tools that should emit as tool_use.
 * May return multiple events (e.g. one per question in AskUserQuestion).
 */
function mapSpecialTool(
  tu: ToolUseBlock,
  pluginId: "claude",
  ts: number,
  nextId: () => string,
): (InputRequestEvent | ModeChangeEvent)[] | undefined {
  if (tu.name === "AskUserQuestion") {
    return extractAllQuestions(tu.input).map((q) => ({
      type: "input_request" as const,
      pluginId,
      ts,
      request: {
        id: nextId(),
        kind: "question" as const,
        ...q,
      },
    }));
  }
  if (tu.name === "EnterPlanMode") {
    return [{ type: "mode_change", pluginId, ts, mode: "plan" }];
  }
  if (tu.name === "ExitPlanMode") {
    return [{
      type: "input_request",
      pluginId,
      ts,
      request: {
        id: nextId(),
        kind: "plan_approval",
        text: "Plan complete. Ready to implement?",
        options: [{ label: "Implement now" }],
      },
    }];
  }
  return undefined;
}

/**
 * Extract ALL questions from AskUserQuestion tool input.
 *
 * The SDK schema uses `questions[]` (array of up to 4), each with
 * `question`, `header`, `options[]`, and `multiSelect`. We map each
 * question into our simpler model. If the input doesn't match the
 * expected shape, fall back to stringified text.
 */
function extractAllQuestions(
  input: Record<string, unknown>,
): { text: string; options: InputRequestOption[] }[] {
  const questions = input.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    return questions.map((raw) => {
      const q = raw as Record<string, unknown>;
      const text = typeof q.question === "string" ? q.question : JSON.stringify(q);
      const rawOpts = Array.isArray(q.options) ? q.options : [];
      const options: InputRequestOption[] = rawOpts
        .filter((o): o is Record<string, unknown> => o != null && typeof o === "object")
        .map((o) => ({
          label: typeof o.label === "string" ? o.label : String(o.label),
          ...(typeof o.description === "string" ? { description: o.description } : {}),
        }));
      return { text, options };
    });
  }
  // Fallback for unexpected shapes
  const text = typeof input.question === "string"
    ? input.question
    : JSON.stringify(input);
  return [{ text, options: [] }];
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
