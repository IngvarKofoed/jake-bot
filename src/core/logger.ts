/** Centralized timestamped logger. */

import type { BotEvent } from "../stream/events.js";

type Level = "info" | "warn" | "error";

function stamp(): string {
  return new Date().toISOString();
}

function fmt(level: Level, tag: string, msg: string): string {
  return `${stamp()} [${level.toUpperCase()}] [${tag}] ${msg}`;
}

export interface Logger {
  info(tag: string, msg: string): void;
  warn(tag: string, msg: string): void;
  error(tag: string, msg: string): void;
}

export const log: Logger = {
  info: (tag, msg) => console.log(fmt("info", tag, msg)),
  warn: (tag, msg) => console.warn(fmt("warn", tag, msg)),
  error: (tag, msg) => console.error(fmt("error", tag, msg)),
};

// -- BotEvent logging --

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\u2026";
}

/**
 * Accumulated content length for open streaming blocks.
 * Callers must supply this so we can report total size at block_close
 * without coupling to StreamCoordinator internals.
 */
export interface OpenBlockLens {
  contentLength(blockId: string): number;
}

const STREAM = "stream";

export function logBotEvent(ev: BotEvent, lens: OpenBlockLens): void {
  const p = ev.pluginId;
  switch (ev.type) {
    case "block_open":
      log.info(STREAM, `[${p}] block_open ${ev.block.kind} id=${ev.block.id}`);
      break;
    case "block_delta":
      // Skipped — too noisy. Content length logged at block_close.
      break;
    case "block_close": {
      const len = lens.contentLength(ev.blockId);
      log.info(STREAM, `[${p}] block_close id=${ev.blockId} (${len} chars)`);
      break;
    }
    case "block_emit":
      if (ev.block.kind === "tool_use") {
        const input = truncate(JSON.stringify(ev.block.input), 120);
        log.info(STREAM, `[${p}] tool_use ${ev.block.toolName} ${input}`);
      } else if (ev.block.kind === "tool_result") {
        const len =
          ev.block.content.format === "text"
            ? ev.block.content.text.length
            : ev.block.content.format === "parts"
              ? ev.block.content.parts.reduce((n, part) => n + part.text.length, 0)
              : 0;
        log.info(
          STREAM,
          `[${p}] tool_result ${ev.block.isError ? "ERROR " : ""}(${len} chars)`,
        );
      } else {
        log.info(STREAM, `[${p}] emit ${ev.block.kind}: ${truncate(ev.block.message, 100)}`);
      }
      break;
    case "complete":
      log.info(
        STREAM,
        `[${p}] complete session=${ev.sessionId ?? "\u2013"} cost=$${ev.costUsd?.toFixed(4) ?? "\u2013"} duration=${ev.durationMs ?? "\u2013"}ms`,
      );
      break;
    case "fatal_error":
      log.error(STREAM, `[${p}] fatal_error: ${ev.error.message}`);
      break;
  }
}
