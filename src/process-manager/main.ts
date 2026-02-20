/**
 * Standalone MCP HTTP daemon for the process manager.
 * Run with: npx tsx src/process-manager/main.ts
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { ProcessSupervisor } from "./supervisor.js";
import { createProcessManagerMcp, DEFAULT_PORT } from "./mcp-server.js";
import { log } from "../core/logger.js";

const port = parseInt(process.env.PROCESS_MANAGER_PORT ?? String(DEFAULT_PORT), 10);
const supervisor = new ProcessSupervisor();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  // Stateless Streamable HTTP MCP endpoint — each request is independent,
  // matching the Python FastMCP stateless_http=True behaviour that worked.
  if (url.pathname === "/mcp" && req.method === "POST") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcpServer = createProcessManagerMcp(supervisor);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", processes: supervisor.list().length }));
    return;
  }

  res.writeHead(404).end("Not found");
});

const TAG = "mcp";

httpServer.listen(port, () => {
  log.info(TAG, `Process Manager listening on http://localhost:${port}`);
  log.info(TAG, `  MCP endpoint: http://localhost:${port}/mcp`);
  log.info(TAG, `  Health check: http://localhost:${port}/health`);

  supervisor.start({
    name: "jake-bot",
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    pipeOutput: true,
  });
});

// Graceful shutdown
async function shutdown() {
  log.info(TAG, "Shutting down...");
  await supervisor.stopAll();
  httpServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
