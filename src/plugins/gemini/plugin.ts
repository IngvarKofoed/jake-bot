import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CliPlugin, ExecuteInput, PluginContext, ConversationInfo } from "../types.js";
import type { BotEvent } from "../../stream/events.js";
import { GeminiEventParser } from "./event-parser.js";
import { prepareGeminiLaunch } from "./mcp-config.js";

export class GeminiPlugin implements CliPlugin {
  readonly id = "gemini";
  readonly displayName = "Gemini";

  constructor(private readonly bin = "gemini") {}

  async *execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent> {
    const launch = await prepareGeminiLaunch({
      workdir: input.workdir,
      sessionId: input.sessionId,
      mcpEndpoints: ctx.mcpEndpoints,
    });

    const args = ["-p", input.message, "-o", "stream-json", "-y"];
    if (input.sessionId) args.push("--resume", input.sessionId);

    const child = spawn(this.bin, args, {
      cwd: input.workdir,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const parser = new GeminiEventParser(input.sessionId);

    try {
      const rl = createInterface({ input: child.stdout! });

      for await (const line of rl) {
        const events = parser.pushLine(line);
        for (const ev of events) yield ev;
      }

      const code = await new Promise<number | null>((resolve) =>
        child.once("close", resolve),
      );
      yield* parser.finish(code ?? 1);
    } finally {
      await launch.cleanup?.();
    }
  }

  async listConversations(): Promise<ConversationInfo[]> {
    return [];
  }
}
