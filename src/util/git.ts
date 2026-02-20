import { execFile } from "node:child_process";

/**
 * Walk up from `cwd` to find the git root directory.
 * Returns null if not inside a git repo.
 */
export function findGitRoot(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.trim() || null);
      },
    );
  });
}
