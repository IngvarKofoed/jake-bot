import type { Renderer } from "./types.js";
import type { BlockEmitEvent } from "../stream/events.js";

/**
 * WhatsApp renderer stub -- uses plain text with minimal formatting.
 */
export class WhatsAppRenderer implements Renderer {
  renderStreaming(kind: "text" | "thinking", content: string): string {
    if (kind === "thinking") {
      const preview = content.slice(0, 80).replace(/\n/g, " ");
      return `_${preview}${content.length > 80 ? "\u2026" : ""}_\n`;
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
        return `*Error:* ${event.block.message}\n`;
      case "system":
        return `_${event.block.subtype}: ${event.block.message}_\n`;
    }
  }

  renderToolHeader(toolName: string, input: Record<string, unknown>): string {
    if (Object.keys(input).length === 0) return `*${toolName}*`;
    let preview = Object.entries(input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (preview.length > 80) preview = preview.slice(0, 80) + "\u2026";
    return `*${toolName}*(${preview})`;
  }

  renderToolResult(content: string, isError: boolean): string {
    if (!content) return "";
    const prefix = isError ? "Error: " : "";
    const truncated = content.length > 400 ? content.slice(0, 400) + "\u2026" : content;
    return `${prefix}\`\`\`${truncated}\`\`\``;
  }
}
