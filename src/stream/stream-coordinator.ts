import type { BotEvent, CompleteEvent, FatalErrorEvent } from "./events.js";
import type { ChatPlatform, MessageRef } from "../platform/types.js";
import type { Renderer } from "../rendering/types.js";
import { logBotEvent } from "../core/logger.js";

interface OpenBlock {
  kind: "text" | "thinking";
  content: string;
  renderStart: number;
}

/**
 * Unclosed code fence detection for safe message splitting.
 * Returns the fence line (e.g. "```json") if unclosed, null otherwise.
 */
function unclosedCodeFence(text: string): string | null {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      fence = fence === null ? stripped : null;
    }
  }
  return fence;
}

export class StreamCoordinator {
  constructor(
    private readonly platform: ChatPlatform,
    private readonly renderer: Renderer,
  ) {}

  async run(
    channelId: string,
    events: AsyncIterable<BotEvent>,
  ): Promise<CompleteEvent | FatalErrorEvent | undefined> {
    const { charLimit, supportsEdit, editRateLimitMs } = this.platform.constraints;

    let buffer = "";
    let msg: MessageRef | undefined;
    let lastEdit = 0;
    let result: CompleteEvent | FatalErrorEvent | undefined;

    const openBlocks = new Map<string, OpenBlock>();

    const flush = async (force = false) => {
      if (!buffer) return;
      const now = Date.now();
      if (!force && now - lastEdit < editRateLimitMs) return;

      const text = buffer.slice(0, charLimit);
      if (!msg || !supportsEdit) {
        stopTyping();
        msg = await this.platform.send(channelId, { text, parseMode: "markdown" });
      } else {
        await this.platform.edit(msg, { text, parseMode: "markdown" });
      }
      lastEdit = Date.now();
    };

    const split = async () => {
      while (buffer.length > charLimit) {
        const overflow = buffer.slice(charLimit);
        buffer = buffer.slice(0, charLimit);

        const fence = unclosedCodeFence(buffer);
        if (fence) buffer += "\n```";

        await flush(true);
        msg = undefined;
        buffer = fence ? `${fence}\n${overflow}` : overflow;
      }
    };

    const finalize = async () => {
      if (buffer) {
        await split();
        await flush(true);
      }
      msg = undefined;
      buffer = "";
      startTyping();
    };

    const lens = {
      contentLength: (id: string) => openBlocks.get(id)?.content.length ?? 0,
    };

    // Show "typing..." indicator during idle gaps (before first token, during tool execution).
    // Discord's indicator expires after ~10s, so refresh every 8s.
    // Typing stops automatically when a message is sent; restarts after finalize().
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const startTyping = () => {
      if (!this.platform.sendTyping || typingTimer !== undefined) return;
      const fire = () => void this.platform.sendTyping!(channelId).catch(() => {});
      fire();
      typingTimer = setInterval(fire, 8_000);
    };
    const stopTyping = () => {
      if (typingTimer !== undefined) {
        clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };
    startTyping();

    for await (const ev of events) {
      logBotEvent(ev, lens);
      switch (ev.type) {
        case "block_open":
          openBlocks.set(ev.block.id, {
            kind: ev.block.kind,
            content: "",
            renderStart: buffer.length,
          });
          break;

        case "block_delta": {
          const ob = openBlocks.get(ev.blockId);
          if (!ob) break;
          ob.content += ev.delta;
          const rendered = this.renderer.renderStreaming(ob.kind, ob.content);
          buffer = buffer.slice(0, ob.renderStart) + rendered;
          await split();
          await flush();
          break;
        }

        case "block_close":
          openBlocks.delete(ev.blockId);
          break;

        case "block_emit":
          if (ev.block.kind === "tool_use") {
            await finalize();
            buffer = this.renderer.renderToolHeader(ev.block.toolName, ev.block.input);
            await flush();
          } else if (ev.block.kind === "tool_result") {
            const text =
              ev.block.content.format === "text"
                ? ev.block.content.text
                : ev.block.content.format === "parts"
                  ? ev.block.content.parts.map((p) => p.text).join("\n")
                  : "";
            buffer += "\n" + this.renderer.renderToolResult(text, ev.block.isError);
            await finalize();
          } else {
            buffer += this.renderer.renderEmit(ev);
            await split();
            await flush();
          }
          break;

        case "complete":
          result = ev;
          break;

        case "fatal_error":
          buffer += `\n\u274C ${ev.error.message}\n`;
          result = ev;
          break;
      }

      if (ev.type === "complete" || ev.type === "fatal_error") break;
    }

    stopTyping();
    await finalize();
    return result;
  }
}
