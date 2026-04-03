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
        msg = await this.platform.send(channelId, { text, parseMode: "markdown" });
        // Discord auto-clears typing on message send; re-fire immediately to keep it visible
        if (this.platform.sendTyping && typingTimer !== undefined) {
          void this.platform.sendTyping(channelId).catch(() => {});
        }
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

        // After split, all open blocks' renderStart offsets pointed into the
        // old (pre-split) buffer. Recalculate: any block whose renderStart
        // was beyond the split point now starts at 0 (its rendered content
        // was carried into the overflow). Blocks entirely before the split
        // were already flushed and their content is gone.
        for (const ob of openBlocks.values()) {
          // The block's rendered content was re-appended by the overflow,
          // so its new start is wherever it landed in the new buffer.
          // Since we're in a streaming block, the last render occupies
          // buffer[renderStart..end]. After split, the new buffer IS the
          // overflow — so the block starts at 0 (only one block streams
          // at a time). For safety with multiple concurrent open blocks,
          // search for the rendered content.
          const rendered = this.renderer.renderStreaming(ob.kind, ob.content);
          const idx = buffer.lastIndexOf(rendered);
          ob.renderStart = idx >= 0 ? idx : buffer.length;
        }
      }
    };

    const finalize = async () => {
      if (buffer) {
        await split();
        await flush(true);
      }
      msg = undefined;
      buffer = "";
    };

    const lens = {
      contentLength: (id: string) => openBlocks.get(id)?.content.length ?? 0,
    };

    // Show "typing..." indicator continuously from start until completion.
    // Discord's indicator expires after ~10s, so refresh every 8s.
    // Discord auto-clears typing on message send, so flush() re-fires immediately.
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const startTyping = () => {
      if (!this.platform.sendTyping || typingTimer !== undefined) return;
      const fire = () => void this.platform.sendTyping!(channelId).catch(() => {});
      fire();
      typingTimer = setInterval(fire, 8_000);
    };
    const stopTyping = async () => {
      if (typingTimer !== undefined) {
        clearInterval(typingTimer);
        typingTimer = undefined;
        await this.platform.stopTyping?.(channelId)?.catch(() => {});
      }
    };
    startTyping();

    try {
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
              await finalize();
            } else if (ev.block.kind === "tool_result") {
              const text =
                ev.block.content.format === "text"
                  ? ev.block.content.text
                  : ev.block.content.format === "parts"
                    ? ev.block.content.parts.map((p) => p.text).join("\n")
                    : "";
              const rendered = this.renderer.renderToolResult(text, ev.block.isError);
              if (rendered) {
                buffer += rendered;
                await finalize();
              }
            } else {
              buffer += this.renderer.renderEmit(ev);
              await split();
              await flush();
            }
            break;

          case "input_request":
            await finalize();
            buffer = this.renderer.renderInputRequest(ev.request.kind, ev.request.text, ev.request.options);
            await finalize();
            break;

          case "mode_change":
            await finalize();
            buffer = this.renderer.renderModeChange(ev.mode);
            await finalize();
            break;

          case "complete":
            result = ev;
            break;

          case "fatal_error":
            buffer += this.renderer.renderFatalError(ev.error.message);
            result = ev;
            break;
        }

        if (ev.type === "complete" || ev.type === "fatal_error") break;
      }
    } catch (err) {
      // Plugin generator threw instead of yielding fatal_error.
      // Render the error inline so the adapter's catch block doesn't
      // produce a second, duplicate error message.
      const message = err instanceof Error ? err.message : String(err);
      buffer += this.renderer.renderFatalError(message);
    }

    if (result?.type === "complete" && this.renderer.renderFooter) {
      const footer = this.renderer.renderFooter(result.durationMs, result.costUsd);
      if (footer) buffer += `${buffer ? "\n" : ""}${footer}`;
    }

    await stopTyping();
    await finalize();
    return result;
  }
}
