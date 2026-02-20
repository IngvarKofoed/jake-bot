/** Semantic content types a plugin can emit. */
export type BlockKind =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error"
  | "system";

interface BaseEvent {
  /** Which plugin produced this event. */
  pluginId: "claude" | "gemini" | "codex";
  /** Monotonic timestamp (Date.now()). */
  ts: number;
}

// -- BLOCK_OPEN: a new streaming block begins --

export interface TextOpenEvent extends BaseEvent {
  type: "block_open";
  block: { id: string; kind: "text" };
}

export interface ThinkingOpenEvent extends BaseEvent {
  type: "block_open";
  block: { id: string; kind: "thinking" };
}

export type BlockOpenEvent = TextOpenEvent | ThinkingOpenEvent;

// -- BLOCK_DELTA: incremental content appended to an open block --

export interface BlockDeltaEvent extends BaseEvent {
  type: "block_delta";
  blockId: string;
  delta: string;
}

// -- BLOCK_CLOSE: streaming block finished --

export interface BlockCloseEvent extends BaseEvent {
  type: "block_close";
  blockId: string;
}

// -- TOOL_USE: an AI model invoked a tool --

export interface ToolUseEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "tool_use";
    toolName: string;
    toolId: string;
    input: Record<string, unknown>;
  };
}

// -- TOOL_RESULT: output returned by a tool --

export type ToolResultContent =
  | { format: "text"; text: string }
  | { format: "parts"; parts: Array<{ type: "text"; text: string }> }
  | { format: "empty" };

export interface ToolResultEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "tool_result";
    toolUseId: string;
    isError: boolean;
    content: ToolResultContent;
  };
}

// -- ERROR: non-fatal error within a turn --

export interface ErrorEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "error";
    message: string;
    code?: string;
    retryable: boolean;
  };
}

// -- SYSTEM: init, rate limit, notices --

export interface SystemEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "system";
    subtype: "init" | "rate_limit" | "notice";
    message: string;
  };
}

export type BlockEmitEvent =
  | ToolUseEmitEvent
  | ToolResultEmitEvent
  | ErrorEmitEvent
  | SystemEmitEvent;

// -- Conversation lifecycle events --

export interface CompleteEvent extends BaseEvent {
  type: "complete";
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
}

export interface FatalErrorEvent extends BaseEvent {
  type: "fatal_error";
  error: { message: string; code?: string; stack?: string };
}

// -- The union --

export type BotEvent =
  | BlockOpenEvent
  | BlockDeltaEvent
  | BlockCloseEvent
  | BlockEmitEvent
  | CompleteEvent
  | FatalErrorEvent;

export function assertNever(x: never): never {
  throw new Error(`Unhandled event variant: ${JSON.stringify(x)}`);
}
