import type { Renderer } from "./types.js";
import type { BlockEmitEvent } from "../stream/events.js";

const BARE_URL_RE = /(?<![<(])(https?:\/\/\S+)/g;

export class DiscordRenderer implements Renderer {
  renderStreaming(kind: "text" | "thinking", content: string): string {
    if (kind === "thinking") {
      const preview = content.slice(0, 80).replace(/\n/g, " ");
      return `\n-# \u{1F4AD} ${preview}${content.length > 80 ? "\u2026" : ""}\n`;
    }
    return this.suppressEmbeds(content);
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
        return `\n\u274C **Error:** ${event.block.message}\n`;
      case "system":
        return `\n-# \u2139\uFE0F ${event.block.subtype}: ${event.block.message}\n`;
    }
  }

  renderToolHeader(toolName: string, input: Record<string, unknown>): string {
    if (Object.keys(input).length === 0) return `-# \u{1F527} ${toolName}`;
    let preview = Object.entries(input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (preview.length > 80) preview = preview.slice(0, 80) + "\u2026";
    return `-# \u{1F527} ${toolName}(${preview})`;
  }

  renderToolResult(content: string, isError: boolean): string {
    if (!content) return "";
    const prefix = isError ? "\u26A0\uFE0F " : "";
    const lines = content.split("\n");
    let truncated =
      lines.length > 6
        ? lines.slice(0, 6).join("\n") + `\n\u2026 (${lines.length - 6} more lines)`
        : content;
    if (truncated.length > 400) {
      truncated = truncated.slice(0, 400) + "\n\u2026 (truncated)";
    }
    return `${prefix}\`\`\`\n${truncated}\n\`\`\``;
  }

  renderFatalError(message: string): string {
    return `\n\u274C ${message}\n`;
  }

  renderFooter(durationMs?: number): string {
    if (durationMs === undefined) return "";
    const seconds = durationMs / 1000;
    const label =
      seconds < 60
        ? `${seconds.toFixed(1)}s`
        : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `-# *Duration: ${label}*`;
  }

  suppressEmbeds(text: string): string {
    return text.replace(BARE_URL_RE, "<$1>");
  }
}
