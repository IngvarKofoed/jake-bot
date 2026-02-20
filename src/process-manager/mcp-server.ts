import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProcessSupervisor } from "./supervisor.js";

export const DEFAULT_PORT = 8901;

export function createProcessManagerMcp(supervisor: ProcessSupervisor) {
  const server = new McpServer({
    name: "process-manager",
    version: "1.0.0",
  });

  server.tool(
    "start_process",
    "Start a named long-running process. Idempotent.",
    {
      name: z.string().describe("Unique name for this process"),
      command: z.string().describe("Executable to run"),
      args: z.array(z.string()).optional().describe("Command arguments"),
      cwd: z.string().describe("Working directory"),
      env: z.record(z.string(), z.string()).optional().describe("Extra env vars"),
    },
    async (input) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await supervisor.start(input)) }],
    }),
  );

  server.tool(
    "stop_process",
    "Stop a managed process. SIGTERM -> wait -> SIGKILL.",
    {
      name: z.string(),
      force: z.boolean().optional(),
    },
    async ({ name, force }) => ({
      content: [
        { type: "text" as const, text: JSON.stringify(await supervisor.stop(name, force)) },
      ],
    }),
  );

  server.tool(
    "restart_process",
    "Restart a managed process (stop then start with same config).",
    {
      name: z.string(),
      force: z.boolean().optional(),
    },
    async ({ name, force }) => {
      const existing = supervisor.list().find((p) => p.name === name);
      if (!existing) throw new Error(`No process named '${name}'`);
      await supervisor.stop(name, force);
      const restarted = await supervisor.start({
        name: existing.name,
        command: existing.command,
        args: existing.args,
        cwd: existing.cwd,
        env: existing.env,
        pipeOutput: existing.pipeOutput,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(restarted) }],
      };
    },
  );

  server.tool(
    "list_processes",
    "List all managed processes with status.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(supervisor.list()) }],
    }),
  );

  server.tool(
    "get_output",
    "Get buffered stdout/stderr from a process.",
    {
      name: z.string(),
      tail: z.number().optional(),
    },
    async ({ name, tail }) => ({
      content: [{ type: "text" as const, text: JSON.stringify(supervisor.getOutput(name, tail)) }],
    }),
  );

  return server;
}
