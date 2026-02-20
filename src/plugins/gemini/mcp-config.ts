import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findGitRoot } from "../../util/git.js";
import type { PluginContext } from "../types.js";

export interface LaunchConfig {
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup?: () => Promise<void>;
}

export async function prepareGeminiLaunch(opts: {
  workdir: string;
  sessionId?: string;
  mcpEndpoints: PluginContext["mcpEndpoints"];
}): Promise<LaunchConfig> {
  const env = { ...process.env };

  // Inject MCP server into .gemini/settings.json at the git root
  const gitRoot = (await findGitRoot(opts.workdir)) ?? opts.workdir;
  const settingsPath = join(gitRoot, ".gemini", "settings.json");

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

  const cleanup = async () => {
    try {
      if (existed && originalSettings !== null) {
        await writeFile(settingsPath, originalSettings);
      } else if (!existed) {
        await unlink(settingsPath).catch(() => {});
      }
    } catch {
      /* best effort */
    }
  };

  return { args: [], env, cleanup };
}
