import type { Renderer } from "./types.js";
import type { BlockEmitEvent, InputRequestKind, ExecutionMode } from "../stream/events.js";

/**
 * Plain-text renderer for the web voice adapter.
 * Outputs clean text suitable for TTS and browser display.
 */
export class WebRenderer implements Renderer {
  renderStreaming(kind: "text" | "thinking", content: string): string {
    if (kind === "thinking") {
      const flat = content.replace(/\n/g, " ");
      return `[thinking] ${flat}\n`;
    }
    return content;
  }

  renderEmit(event: BlockEmitEvent): string {
    switch (event.block.kind) {
      case "tool_use":
        return this.renderToolHeader(event.block.toolName, event.block.input);
      case "tool_result": {
        const text =
          event.block.content.format === "text"
            ? event.block.content.text
            : event.block.content.format === "parts"
              ? event.block.content.parts.map((p) => p.text).join("\n")
              : "";
        return this.renderToolResult(text, event.block.isError);
      }
      case "error":
        return `\nError: ${event.block.message}\n`;
      case "system":
        return `\n${event.block.subtype}: ${event.block.message}\n`;
    }
  }

  renderToolHeader(toolName: string, input: Record<string, unknown>): string {
    if (Object.keys(input).length === 0) return `Tool: ${toolName}`;
    let preview = Object.entries(input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (preview.length > 80) preview = preview.slice(0, 80) + "...";
    return `Tool: ${toolName}(${preview})`;
  }

  renderToolResult(content: string, isError: boolean): string {
    if (!content) return "";
    const prefix = isError ? "Warning: " : "";
    const lines = content.split("\n");
    let truncated =
      lines.length > 6
        ? lines.slice(0, 6).join("\n") + `\n... (${lines.length - 6} more lines)`
        : content;
    if (truncated.length > 400) {
      truncated = truncated.slice(0, 400) + "\n... (truncated)";
    }
    return `${prefix}${truncated}`;
  }

  renderInputRequest(_kind: InputRequestKind, text: string): string {
    return `[question] ${text}`;
  }

  renderModeChange(mode: ExecutionMode): string {
    return mode === "plan"
      ? `[mode:plan] Entering plan mode`
      : `[action:implement]`;
  }

  renderFatalError(message: string): string {
    return `\nError: ${message}\n`;
  }

  renderFooter(durationMs?: number): string {
    if (durationMs === undefined) return "";
    const seconds = durationMs / 1000;
    const label =
      seconds < 60
        ? `${seconds.toFixed(1)}s`
        : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `Duration: ${label}`;
  }
}
