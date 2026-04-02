/**
 * Voice-controlled web adapter.
 *
 * Serves a self-contained HTML page with Web Speech API integration.
 * Uses SSE for streaming responses and POST for receiving messages.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BotConfig } from "../config.js";
import type { PluginRegistry } from "../core/plugin-registry.js";
import type { ActiveConversations } from "../core/active-conversations.js";
import { Router } from "../core/router.js";
import { WebPlatform, type WebPlatformEvent } from "../platform/web.js";
import { WebRenderer } from "../rendering/web-renderer.js";
import type { PluginContext } from "../plugins/types.js";
import type { BotAdapter } from "./types.js";
import { WEB_PAGE_HTML } from "./web-page.js";
import { log } from "../core/logger.js";
import { synthesizeStreaming } from "../core/google-tts.js";

const TAG = "web";

/** Slash commands: /claude [workdir], /end, /status, /clear */
const SLASH_START_RE = /^\/(claude|gemini|codex)(?:\s+(.+))?$/i;
const SLASH_END_RE = /^\/end$/i;
const SLASH_STATUS_RE = /^\/status$/i;
const SLASH_CLEAR_RE = /^\/clear$/i;

/** Voice command patterns parsed before routing. */
const START_RE = /^(?:start|use|open)\s+(claude|gemini|codex)(?:\s+(?:in\s+)?(.+))?$/i;
const SWITCH_RE = /^switch\s+to\s+(claude|gemini|codex)$/i;
const END_RE = /^(?:end|stop|close|quit)\s+(?:conversation|chat|session)$/i;

function channelId(session: string): string {
  return `web:${session}`;
}

export class WebAdapter implements BotAdapter {
  private readonly platform: WebPlatform;
  private readonly router: Router;
  private readonly busy = new Set<string>();

  constructor(
    private readonly config: BotConfig,
    private readonly plugins: PluginRegistry,
    private readonly conversations: ActiveConversations,
    private readonly ctx: PluginContext,
  ) {
    this.platform = new WebPlatform();
    const renderer = new WebRenderer();
    this.router = new Router(plugins, conversations, this.platform, renderer, ctx);
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => this.handleRequest(req, res));
    server.listen(this.config.webPort, () => {
      log.info(TAG, `Web adapter listening on http://localhost:${this.config.webPort}`);
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost:${this.config.webPort}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(WEB_PAGE_HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      this.handleSSE(url, req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      this.handleMessage(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tts") {
      this.handleTTS(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404).end("Not found");
  }

  // -- SSE endpoint --

  private handleSSE(url: URL, req: IncomingMessage, res: ServerResponse): void {
    const session = url.searchParams.get("session");
    if (!session) {
      res.writeHead(400).end("Missing session parameter");
      return;
    }

    const cid = channelId(session);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n"); // flush headers to establish SSE connection

    const emitter = this.platform.subscribe(cid);
    const onEvent = (ev: WebPlatformEvent) => {
      res.write(`event: event\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    emitter.on("event", onEvent);

    // System events (conversation lifecycle)
    const onSystem = (data: Record<string, unknown>) => {
      res.write(`event: system\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emitter.on("system", onSystem);

    // Heartbeat to prevent proxy timeouts
    const heartbeat = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 30_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      emitter.off("event", onEvent);
      emitter.off("system", onSystem);
      this.platform.unsubscribe(cid);
    });
  }

  // -- Message endpoint --

  private handleMessage(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      void this.processMessage(body, res);
    });
  }

  private async processMessage(body: string, res: ServerResponse): Promise<void> {
    let parsed: { session: string; text: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { session, text } = parsed;
    if (!session || !text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session or text" }));
      return;
    }

    const cid = channelId(session);
    const userId = `web:${session}`;

    // Busy guard
    if (this.busy.has(cid)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "busy" }));
      return;
    }

    const trimmed = text.trim();

    // -- Slash commands --

    const slashStart = trimmed.match(SLASH_START_RE);
    if (slashStart) {
      const pluginId = slashStart[1].toLowerCase();
      const workdir = slashStart[2]?.trim() || this.config.defaultWorkdir;
      return this.startConversation(userId, cid, pluginId, workdir, res);
    }

    if (SLASH_END_RE.test(trimmed)) {
      const ended = this.conversations.end(userId, cid);
      this.emitSystem(cid, { type: ended ? "ended" : "error", message: ended ? undefined : "No active conversation" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (SLASH_STATUS_RE.test(trimmed)) {
      const convo = this.conversations.get(userId, cid);
      if (!convo) {
        this.emitSystem(cid, { type: "error", message: "No active conversation" });
      } else {
        const plugin = this.plugins.get(convo.pluginId);
        this.emitSystem(cid, {
          type: "status",
          plugin: plugin?.displayName ?? convo.pluginId,
          workdir: convo.workdir,
          sessionId: convo.sessionId ?? "new",
        });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (SLASH_CLEAR_RE.test(trimmed)) {
      const convo = this.conversations.clear(userId, cid);
      if (!convo) {
        this.emitSystem(cid, { type: "error", message: "No active conversation" });
      } else {
        const plugin = this.plugins.get(convo.pluginId);
        this.emitSystem(cid, { type: "started", plugin: plugin?.displayName ?? convo.pluginId });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // -- Voice commands --

    const startMatch = trimmed.match(START_RE);
    if (startMatch) {
      const pluginId = startMatch[1].toLowerCase();
      const workdir = startMatch[2]?.trim() || this.config.defaultWorkdir;
      return this.startConversation(userId, cid, pluginId, workdir, res);
    }

    const switchMatch = trimmed.match(SWITCH_RE);
    if (switchMatch) {
      this.conversations.end(userId, cid);
      const pluginId = switchMatch[1].toLowerCase();
      return this.startConversation(userId, cid, pluginId, this.config.defaultWorkdir, res);
    }

    if (END_RE.test(trimmed)) {
      const ended = this.conversations.end(userId, cid);
      this.emitSystem(cid, { type: ended ? "ended" : "error", message: ended ? undefined : "No active conversation" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Auto-start with default plugin if no active conversation
    if (!this.conversations.get(userId, cid)) {
      const pluginId = this.config.defaultPlugin;
      try {
        this.conversations.start(userId, cid, pluginId, this.config.defaultWorkdir);
        this.emitSystem(cid, { type: "started", plugin: this.plugins.require(pluginId).displayName });
      } catch (err) {
        this.emitSystem(cid, { type: "error", message: (err as Error).message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }
    }

    // Route to active conversation
    this.busy.add(cid);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    try {
      await this.router.route(userId, cid, trimmed);
    } catch (err) {
      log.error(TAG, `Route error: ${err instanceof Error ? err.message : String(err)}`);
      this.emitSystem(cid, { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy.delete(cid);
      // Signal the browser that the response is complete
      this.emitDone(cid);
    }
  }

  private startConversation(
    userId: string,
    cid: string,
    pluginId: string,
    workdir: string,
    res: ServerResponse,
  ): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      this.emitSystem(cid, { type: "error", message: `Plugin "${pluginId}" not available` });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Plugin "${pluginId}" not available` }));
      return;
    }

    try {
      // End existing conversation if any
      this.conversations.end(userId, cid);
      this.conversations.start(userId, cid, pluginId, workdir);
      this.emitSystem(cid, { type: "started", plugin: plugin.displayName });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      this.emitSystem(cid, { type: "error", message: (err as Error).message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  // -- TTS endpoint --

  private handleTTS(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      void this.processTTS(body, res);
    });
  }

  private async processTTS(body: string, res: ServerResponse): Promise<void> {
    const apiKey = this.config.googleApiKey;
    if (!apiKey) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "TTS not configured (no GOOGLE_API_KEY)" }));
      return;
    }

    let parsed: { session: string; text: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { session, text } = parsed;
    if (!session || !text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session or text" }));
      return;
    }

    const cid = channelId(session);

    // Return immediately — audio chunks arrive via SSE
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    try {
      const emitter = this.platform.subscribe(cid);
      await synthesizeStreaming(text, apiKey, (audio, index, total) => {
        if (audio) {
          emitter.emit("event", { type: "audio", audio, index, total } as WebPlatformEvent);
        }
      });
      emitter.emit("event", { type: "audio_done" } as WebPlatformEvent);
    } catch (err) {
      log.error(TAG, `TTS error: ${err instanceof Error ? err.message : String(err)}`);
      const emitter = this.platform.subscribe(cid);
      emitter.emit("event", { type: "audio_done" } as WebPlatformEvent);
    }
  }

  private emitSystem(cid: string, data: Record<string, unknown>): void {
    const emitter = this.platform.subscribe(cid);
    emitter.emit("system", data);
  }

  private emitDone(cid: string): void {
    const emitter = this.platform.subscribe(cid);
    emitter.emit("event", { type: "done" } as WebPlatformEvent);
  }
}
