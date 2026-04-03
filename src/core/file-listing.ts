/**
 * Platform-agnostic directory listing for file-completion UIs.
 *
 * Lists a single directory level at a time so the frontend can
 * incrementally drill down as the user types path separators.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface FileEntry {
  /** Path relative to workdir, using forward slashes. */
  readonly path: string;
  /** `true` when the entry is a directory. */
  readonly isDirectory: boolean;
}

export interface ListFilesOptions {
  /** Working directory root. */
  workdir: string;
  /** Subdirectory relative to workdir to list (default: root). */
  subdir?: string;
  /** Prefix filter on the filename portion (case-insensitive). */
  query?: string;
  /** Maximum number of results (default: 50). */
  limit?: number;
}

/** Names that are always excluded from listings. */
const IGNORED = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "__pycache__",
  ".env",
]);

/**
 * List files and directories inside `workdir/subdir`, filtered by `query`.
 *
 * Returns entries sorted: directories first, then files, alphabetical
 * within each group.
 *
 * Security: rejects any resolved path that escapes `workdir`.
 */
export async function listFiles(opts: ListFilesOptions): Promise<readonly FileEntry[]> {
  const { workdir, subdir = "", query = "", limit = 50 } = opts;
  const root = resolve(workdir);
  const target = resolve(workdir, subdir);

  // Path traversal guard
  if (!target.startsWith(root)) return [];

  let names: string[];
  try {
    names = await readdir(target);
  } catch {
    return [];
  }

  // Filter ignored entries
  names = names.filter((n) => !IGNORED.has(n));

  // Prefix filter (case-insensitive)
  const q = query.toLowerCase();
  if (q) {
    names = names.filter((n) => n.toLowerCase().startsWith(q));
  }

  // Stat each entry to distinguish files / directories
  const results: FileEntry[] = [];
  for (const name of names) {
    if (results.length >= limit) break;
    const full = join(target, name);
    try {
      const s = await stat(full);
      const rel = relative(workdir, full).replace(/\\/g, "/");
      results.push({ path: rel, isDirectory: s.isDirectory() });
    } catch {
      // Skip inaccessible entries
    }
  }

  // Directories first, then alphabetical
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return results;
}
