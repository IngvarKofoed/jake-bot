/**
 * Standalone MCP HTTP daemon for the process manager.
 * Run with: npx tsx src/process-manager/main.ts
 */

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "node:http";
import { ProcessSupervisor } from "./supervisor.js";
import { createProcessManagerMcp, DEFAULT_PORT } from "./mcp-server.js";
import { log } from "../core/logger.js";

const port = parseInt(process.env.PROCESS_MANAGER_PORT ?? String(DEFAULT_PORT), 10);
const supervisor = new ProcessSupervisor();
const mcpServer = createProcessManagerMcp(supervisor);

// Track active transports for cleanup
const transports = new Map<string, SSEServerTransport>();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  // SSE endpoint -- clients connect here to receive events
  if (url.pathname === "/sse" && req.method === "GET") {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await mcpServer.connect(transport);
    return;
  }

  // Message endpoint -- clients POST JSON-RPC messages here
  if (url.pathname === "/messages" && req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      res.writeHead(400).end("Missing sessionId");
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.writeHead(404).end("Unknown session");
      return;
    }
    await transport.handlePostMessage(req, res);
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
  log.info(TAG, `  SSE endpoint: http://localhost:${port}/sse`);
  log.info(TAG, `  Health check: http://localhost:${port}/health`);
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
