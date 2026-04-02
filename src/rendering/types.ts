import type { BlockEmitEvent, InputRequestKind, InputRequestOption, ExecutionMode } from "../stream/events.js";

export interface Renderer {
  /** Render accumulated content for a streaming text/thinking block. */
  renderStreaming(kind: "text" | "thinking", content: string): string;

  /** Render a one-shot emit event. */
  renderEmit(event: BlockEmitEvent): string;

  /** Render a tool-use header line. */
  renderToolHeader(toolName: string, input: Record<string, unknown>): string;

  /** Render a truncated tool result. */
  renderToolResult(content: string, isError: boolean): string;

  /** Render an input request (the LLM is asking the user a question). */
  renderInputRequest(kind: InputRequestKind, text: string, options: InputRequestOption[]): string;

  /** Render a mode change (e.g. plan mode ↔ execute mode). */
  renderModeChange(mode: ExecutionMode): string;

  /** Render a fatal error message. */
  renderFatalError(message: string): string;

  /** Render a completion footer (duration, cost, etc.). */
  renderFooter?(durationMs?: number, costUsd?: number): string;

  /** Suppress embed previews (platform-specific, optional). */
  suppressEmbeds?(text: string): string;
}
