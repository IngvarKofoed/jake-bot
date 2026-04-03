/**
 * Parse and expand `@path` file references in user messages.
 *
 * Expansion injects file contents inline using `<file>` XML tags that all
 * major LLMs (Claude, Gemini, Codex) understand natively.  The expansion
 * happens in the adapter layer *before* the message reaches the router, so
 * `ExecuteInput`, `Router`, and plugins remain unchanged.
 */

import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileReference {
  /** Raw matched text including the `@`, e.g. `"@src/index.ts"`. */
  readonly raw: string;
  /** Just the path portion, e.g. `"src/index.ts"`. */
  readonly path: string;
  /** Start index in the original message string. */
  readonly start: number;
  /** End index (exclusive) in the original message string. */
  readonly end: number;
}

export interface ExpandResult {
  /** Message with `@path` references replaced by `<file>` blocks. */
  expandedMessage: string;
  /** Paths that were successfully expanded. */
  expandedPaths: readonly string[];
  /** Paths that failed (not found, unreadable, outside workdir). */
  failedPaths: readonly string[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract `@path` tokens from a message.
 *
 * Rules:
 * - `@` must be at the start of the string or preceded by whitespace.
 * - The path must contain at least one `/` or `.` so that bare
 *   `@someone` mentions are not mistaken for file references.
 * - The path ends at the next whitespace or end-of-string.
 */
export function parseFileReferences(message: string): readonly FileReference[] {
  const refs: FileReference[] = [];
  // Match @<path> where the path portion has a `/` or `.`
  const re = /(?:^|(?<=\s))@((?:[^\s@]*\/[^\s@]*)|(?:[^\s@]+\.[^\s@]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    refs.push({
      raw: m[0],
      path: m[1],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/** Maximum bytes we will inline per file. */
const MAX_FILE_BYTES = 100_000;

/** Quick binary detection: scan the first chunk for null bytes. */
function looksLikeBinary(buf: Buffer): boolean {
  const check = Math.min(buf.length, 8192);
  for (let i = 0; i < check; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Expand every `@path` reference by reading the file and injecting its
 * contents inline.  References that cannot be resolved (missing file,
 * outside workdir, binary) are left untouched and reported in
 * `failedPaths`.
 */
export async function expandFileReferences(
  message: string,
  workdir: string,
): Promise<ExpandResult> {
  const refs = parseFileReferences(message);
  if (refs.length === 0) {
    return { expandedMessage: message, expandedPaths: [], failedPaths: [] };
  }

  const expandedPaths: string[] = [];
  const failedPaths: string[] = [];

  // Process right-to-left so earlier indices stay valid.
  let result = message;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    const absPath = resolve(workdir, ref.path);

    // Path traversal guard (follows symlinks for safety).
    try {
      const realAbs = await realpath(absPath);
      const realRoot = await realpath(workdir);
      if (!realAbs.startsWith(realRoot + "/") && realAbs !== realRoot) {
        failedPaths.push(ref.path);
        continue;
      }
    } catch {
      failedPaths.push(ref.path);
      continue;
    }

    try {
      const buf = await readFile(absPath);

      if (looksLikeBinary(buf)) {
        // Leave the reference as-is; report it failed.
        failedPaths.push(ref.path);
        continue;
      }

      let content = buf.toString("utf-8");
      if (content.length > MAX_FILE_BYTES) {
        content = content.slice(0, MAX_FILE_BYTES) + "\n… (truncated)";
      }

      const replacement = `<file path="${ref.path}">\n${content}\n</file>`;
      result = result.slice(0, ref.start) + replacement + result.slice(ref.end);
      expandedPaths.push(ref.path);
    } catch {
      failedPaths.push(ref.path);
    }
  }

  return { expandedMessage: result, expandedPaths, failedPaths };
}
