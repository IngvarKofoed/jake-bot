/** Lightweight timestamped logger. */

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
