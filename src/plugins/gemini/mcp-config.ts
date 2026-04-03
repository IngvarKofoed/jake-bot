import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findGitRoot } from "../../util/git.js";
import type { PluginContext } from "../types.js";

export interface LaunchConfig {
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup?: () => Promise<void>;
}

/**
 * Per-settings-path reference counter to avoid race conditions when
 * multiple concurrent Gemini invocations share the same git root.
 * Only the first acquirer writes the injected settings; only the
 * last releaser restores the original file.
 */
interface ConfigLease {
  refCount: number;
  originalSettings: string | null;
  existed: boolean;
}

const activeLeases = new Map<string, ConfigLease>();

export async function prepareGeminiLaunch(opts: {
  workdir: string;
  sessionId?: string;
  mcpEndpoints: PluginContext["mcpEndpoints"];
}): Promise<LaunchConfig> {
  const env = { ...process.env };

  // Inject MCP server into .gemini/settings.json at the git root
  const gitRoot = (await findGitRoot(opts.workdir)) ?? opts.workdir;
  const settingsPath = join(gitRoot, ".gemini", "settings.json");

  const existingLease = activeLeases.get(settingsPath);
  if (existingLease) {
    // Another invocation already injected settings for this path —
    // just bump the ref count instead of re-reading/re-writing.
    existingLease.refCount++;
  } else {
    let originalSettings: string | null = null;
    let existed = false;

    try {
      originalSettings = await readFile(settingsPath, "utf-8");
      existed = true;
    } catch {
      await mkdir(join(gitRoot, ".gemini"), { recursive: true });
    }

    const settings = existed ? JSON.parse(originalSettings!) : {};
    settings.mcpServers ??= {};
    for (const ep of opts.mcpEndpoints) {
      settings.mcpServers[ep.name] = { url: ep.url, type: "http", trust: true };
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    activeLeases.set(settingsPath, { refCount: 1, originalSettings, existed });
  }

  const cleanup = async () => {
    const lease = activeLeases.get(settingsPath);
    if (!lease) return;

    lease.refCount--;
    if (lease.refCount > 0) return; // Other invocations still using the file

    // Last user — restore original settings
    activeLeases.delete(settingsPath);
    try {
      if (lease.existed && lease.originalSettings !== null) {
        await writeFile(settingsPath, lease.originalSettings);
      } else if (!lease.existed) {
        await unlink(settingsPath).catch(() => {});
      }
    } catch {
      /* best effort */
    }
  };

  return { args: [], env, cleanup };
}
