# jake-bot TypeScript Architecture

> Three-model synthesis (Claude, Gemini, Codex) — February 2026
>
> This document was collaboratively designed by Claude Opus 4.6, Gemini 2.5 Pro,
> and Codex (GPT-5.3). Each model reviewed the existing Python codebase and
> proposed architectural improvements for a TypeScript rewrite.

## Design Goals

1. **Type-safe event model** — discriminated unions replace `metadata: dict[str, Any]`
2. **No async workarounds** — no queue+task bridge, no anyio cancel-scope hacks
3. **Platform-agnostic core** — Discord, Telegram, WhatsApp share one stream coordinator
4. **Plugin isolation** — each CLI adapter is self-contained; adding a new CLI = one file
5. **Process manager via MCP** — long-running processes managed through a standard protocol

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Chat Platforms                         │
│  DiscordPlatform  │  TelegramPlatform  │  WhatsAppPlatform  │
│  (discord.js)     │  (grammY)          │  (Baileys)         │
└────────┬──────────┴────────┬───────────┴────────┬───────────┘
         │                   │                    │
         ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   Platform-Agnostic Core                    │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Router       │  │ StreamCoord.   │  │ ActiveConvos    │  │
│  │              │  │                │  │                 │  │
│  └──────────────┘  └────────────────┘  └─────────────────┘  │
│  ┌──────────────┐  ┌────────────────┐                       │
│  │ Renderer     │  │ PluginRegistry │                       │
│  └──────────────┘  └────────────────┘                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     CLI Plugin Layer                        │
│  ClaudePlugin     │  GeminiPlugin    │  CodexPlugin         │
│  (SDK direct)     │  (spawn+NDJSON)  │  (SDK direct)        │
└────────┬──────────┴────────┬─────────┴────────┬─────────────┘
         │                   │                  │
         ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│     MCP Process Manager (shared, HTTP on :8901)             │
│     start · stop · restart · list · get_output              │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
jake-bot/
  src/
    index.ts                        # entry point
    config.ts                       # env/config loading

    stream/
      events.ts                     # BotEvent discriminated union
      stream-coordinator.ts         # platform-agnostic buffering + throttling

    platform/
      types.ts                      # ChatPlatform + PlatformConstraints interfaces
      discord.ts                    # discord.js implementation
      telegram.ts                   # grammY implementation
      whatsapp.ts                   # Baileys implementation

    rendering/
      types.ts                      # Renderer interface
      discord-renderer.ts
      telegram-renderer.ts
      whatsapp-renderer.ts

    plugins/
      types.ts                      # CliPlugin interface + PluginContext
      claude/
        plugin.ts                   # @anthropic-ai/claude-code SDK
        event-mapper.ts             # SDK messages → BotEvent
      gemini/
        plugin.ts                   # child_process spawn + readline
        event-parser.ts             # NDJSON lines → BotEvent
        mcp-config.ts               # ephemeral config injection
      codex/
        plugin.ts                   # Codex SDK / CLI integration
        event-mapper.ts

    core/
      router.ts                     # message routing
      active-conversations.ts       # (user, channel) → {plugin, workdir, sessionId}
      plugin-registry.ts            # plugin discovery + lookup

    process-manager/
      types.ts                      # ManagedProcess, ProcessStatus, RingBuffer
      supervisor.ts                 # spawn, drain, kill process trees
      mcp-server.ts                 # @modelcontextprotocol/sdk MCP tools

  tests/
  docs/
  package.json
  tsconfig.json
```

---

## 1. Event Model — `BotEvent` Discriminated Union

The single biggest improvement over the Python implementation. Every event
variant carries its own typed payload — no `metadata: Record<string, any>`,
no `.get("tool_name", "tool")` lookups, no `isinstance` chains.

### Block Kinds

```ts
// src/stream/events.ts

/** Semantic content types a plugin can emit. */
export type BlockKind =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error"
  | "system";
```

### Base Fields

Every event carries routing metadata so consumers don't need out-of-band context:

```ts
interface BaseEvent {
  /** Which plugin produced this event. */
  pluginId: "claude" | "gemini" | "codex";
  /** Monotonic timestamp (Date.now()). */
  ts: number;
}
```

### Block Lifecycle Events (Streaming)

```ts
// -- BLOCK_OPEN: a new streaming block begins --

export interface TextOpenEvent extends BaseEvent {
  type: "block_open";
  block: { id: string; kind: "text" };
}

export interface ThinkingOpenEvent extends BaseEvent {
  type: "block_open";
  block: { id: string; kind: "thinking" };
}

export type BlockOpenEvent = TextOpenEvent | ThinkingOpenEvent;

// -- BLOCK_DELTA: incremental content appended to an open block --

export interface BlockDeltaEvent extends BaseEvent {
  type: "block_delta";
  blockId: string;
  delta: string;
}

// -- BLOCK_CLOSE: streaming block finished --

export interface BlockCloseEvent extends BaseEvent {
  type: "block_close";
  blockId: string;
}
```

### One-Shot Emit Events

These arrive complete in a single event. Each variant has fully typed fields:

```ts
// -- TOOL_USE: an AI model invoked a tool --

export interface ToolUseEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "tool_use";
    toolName: string;       // already cleaned: "Process Manager · Restart Process"
    toolId: string;         // correlates with tool_result
    input: Record<string, unknown>;
  };
}

// -- TOOL_RESULT: output returned by a tool --
//
// This replaces Python's `str | list[dict] | None` with a proper
// discriminated union. No more isinstance chains.

export type ToolResultContent =
  | { format: "text"; text: string }
  | { format: "parts"; parts: Array<{ type: "text"; text: string }> }
  | { format: "empty" };

export interface ToolResultEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "tool_result";
    toolUseId: string;      // correlates with tool_use
    isError: boolean;
    content: ToolResultContent;
  };
}

// -- ERROR: non-fatal error within a turn --

export interface ErrorEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "error";
    message: string;
    code?: string;
    retryable: boolean;
  };
}

// -- SYSTEM: init, rate limit, notices --

export interface SystemEmitEvent extends BaseEvent {
  type: "block_emit";
  block: {
    id: string;
    kind: "system";
    subtype: "init" | "rate_limit" | "notice";
    message: string;
  };
}

export type BlockEmitEvent =
  | ToolUseEmitEvent
  | ToolResultEmitEvent
  | ErrorEmitEvent
  | SystemEmitEvent;
```

### Conversation Lifecycle Events

```ts
export interface CompleteEvent extends BaseEvent {
  type: "complete";
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
}

export interface FatalErrorEvent extends BaseEvent {
  type: "fatal_error";
  error: { message: string; code?: string; stack?: string };
}
```

### The Union

```ts
export type BotEvent =
  | BlockOpenEvent
  | BlockDeltaEvent
  | BlockCloseEvent
  | BlockEmitEvent
  | CompleteEvent
  | FatalErrorEvent;
```

### Exhaustive Switch Pattern

TypeScript enforces that every variant is handled at compile time:

```ts
export function assertNever(x: never): never {
  throw new Error(`Unhandled event variant: ${JSON.stringify(x)}`);
}

function processEvent(ev: BotEvent): void {
  switch (ev.type) {
    case "block_open":
      // ev.block.kind is "text" | "thinking" — fully narrowed
      break;
    case "block_delta":
      // ev.delta is string, ev.blockId is string
      break;
    case "block_close":
      break;
    case "block_emit":
      // Second-level discrimination on block.kind
      switch (ev.block.kind) {
        case "tool_use":
          // ev.block.toolName, ev.block.toolId, ev.block.input — all typed
          break;
        case "tool_result":
          // ev.block.content is ToolResultContent — discriminate on .format
          break;
        case "error":
          // ev.block.message, ev.block.retryable
          break;
        case "system":
          // ev.block.subtype is "init" | "rate_limit" | "notice"
          break;
        default:
          assertNever(ev.block);
      }
      break;
    case "complete":
      // ev.sessionId, ev.costUsd, ev.durationMs
      break;
    case "fatal_error":
      // ev.error.message
      break;
    default:
      assertNever(ev);
  }
}
```

### What This Fixes

| Python Pain Point | TypeScript Solution |
|---|---|
| `metadata.get("tool_name", "tool")` | `ev.block.toolName` — compile-time checked |
| `ToolResultBlock.content: str \| list[dict] \| None` | `ToolResultContent` discriminated union on `.format` |
| No exhaustive checking on event types | `assertNever` + `switch` gives compile errors on missing cases |
| `isinstance(block, ToolUseBlock)` chains | Discriminant narrowing via `ev.block.kind` |

---

## 2. CLI Plugin System

### Plugin Interface

```ts
// src/plugins/types.ts

import type { BotEvent } from "../stream/events.js";

export interface ConversationInfo {
  id: string;
  title: string;
  timestamp: Date;
  project?: string;
}

export interface ExecuteInput {
  workdir: string;
  message: string;
  sessionId?: string;
}

/**
 * Context injected into every plugin invocation.
 * Plugins never import globals — everything comes through here.
 */
export interface PluginContext {
  mcpEndpoints: ReadonlyArray<{ name: string; url: string }>;
  logger: Pick<Console, "info" | "warn" | "error">;
}

/**
 * A CLI plugin knows how to invoke a specific AI CLI and translate
 * its output into the BotEvent stream.
 */
export interface CliPlugin {
  readonly id: string;
  readonly displayName: string;

  /**
   * Execute a single turn. Returns an async generator of BotEvents.
   * The generator completes when the CLI turn finishes.
   *
   * No queue bridge needed — TypeScript async generators Just Work
   * across Promise boundaries (no anyio cancel-scope problem).
   */
  execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent, void, void>;

  /** Best-effort listing of past conversations from the CLI. */
  listConversations(workdir?: string): Promise<ConversationInfo[]>;
}
```

### Claude Code Plugin — SDK Direct

The `@anthropic-ai/claude-code` TypeScript SDK is first-party. No subprocess,
no output parsing, no queue bridge. `for await` directly yields events:

```ts
// src/plugins/claude/plugin.ts

import { query } from "@anthropic-ai/claude-code";
import type { CliPlugin, ExecuteInput, PluginContext } from "../types.js";
import type { BotEvent } from "../../stream/events.js";
import { mapClaudeMessage } from "./event-mapper.js";

export class ClaudePlugin implements CliPlugin {
  readonly id = "claude";
  readonly displayName = "Claude Code";

  constructor(
    private readonly maxTurns = 30,
    private readonly maxBudgetUsd = 5.0,
  ) {}

  async *execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent> {
    const mcpEndpoint = ctx.mcpEndpoints.find(e => e.name === "process-manager");

    const options = {
      permissionMode: "bypassPermissions" as const,
      maxTurns: this.maxTurns,
      maxBudgetUsd: this.maxBudgetUsd,
      cwd: input.workdir,
      settingSources: ["user", "project", "local"],
      resume: input.sessionId,
      mcpServers: mcpEndpoint
        ? { "process-manager": { type: "http" as const, url: mcpEndpoint.url } }
        : {},
    };

    // No queue bridge, no task isolation — just iterate.
    // In Python this required ~15 lines of asyncio.Queue boilerplate
    // due to anyio cancel-scope constraints. In TS: zero.
    for await (const msg of query({ prompt: input.message, options })) {
      yield* mapClaudeMessage(msg, "claude");
    }
  }

  async listConversations(): Promise<ConversationInfo[]> {
    // Walk ~/.claude/projects/*//*.jsonl — same logic as Python,
    // using fs/promises + readline.
    return [];
  }
}
```

The event mapper is a pure function — no side effects, easy to test:

```ts
// src/plugins/claude/event-mapper.ts

import type {
  AssistantMessage, ResultMessage, SystemMessage,
  TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
} from "@anthropic-ai/claude-code";
import type { BotEvent, ToolResultContent } from "../../stream/events.js";
import { cleanToolName } from "../util.js";

let blockSeq = 0;
const nextId = () => `b${blockSeq++}`;

export function* mapClaudeMessage(
  msg: AssistantMessage | ResultMessage | SystemMessage,
  pluginId: "claude",
): Generator<BotEvent> {
  const ts = Date.now();

  if ("content" in msg && Array.isArray(msg.content)) {
    // AssistantMessage
    for (const block of msg.content) {
      if (isTextBlock(block)) {
        const id = nextId();
        yield { type: "block_open", pluginId, ts, block: { id, kind: "text" } };
        yield { type: "block_delta", pluginId, ts, blockId: id, delta: block.text };
        yield { type: "block_close", pluginId, ts, blockId: id };
      }

      if (isThinkingBlock(block)) {
        const id = nextId();
        yield { type: "block_open", pluginId, ts, block: { id, kind: "thinking" } };
        yield { type: "block_delta", pluginId, ts, blockId: id, delta: block.thinking };
        yield { type: "block_close", pluginId, ts, blockId: id };
      }

      if (isToolUseBlock(block)) {
        yield {
          type: "block_emit", pluginId, ts,
          block: {
            id: nextId(),
            kind: "tool_use",
            toolName: cleanToolName(block.name),
            toolId: block.id,
            input: block.input as Record<string, unknown>,
          },
        };
      }

      if (isToolResultBlock(block)) {
        yield {
          type: "block_emit", pluginId, ts,
          block: {
            id: nextId(),
            kind: "tool_result",
            toolUseId: block.tool_use_id,
            isError: block.is_error ?? false,
            content: normalizeToolResultContent(block.content),
          },
        };
      }
    }
  }

  if (isResultMessage(msg)) {
    yield {
      type: "complete", pluginId, ts,
      sessionId: msg.session_id,
      costUsd: msg.total_cost_usd,
      durationMs: msg.duration_ms,
    };
  }
}

/**
 * Normalize the SDK's `string | ContentBlock[] | null` into our
 * ToolResultContent discriminated union. This replaces Python's
 * defensive isinstance chains with a clean type switch.
 */
function normalizeToolResultContent(
  raw: string | Array<{ type: string; text?: string }> | null | undefined,
): ToolResultContent {
  if (raw == null) return { format: "empty" };
  if (typeof raw === "string") return { format: "text", text: raw };
  if (Array.isArray(raw)) {
    const parts = raw
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map(p => ({ type: "text" as const, text: p.text }));
    return parts.length > 0 ? { format: "parts", parts } : { format: "empty" };
  }
  return { format: "empty" };
}

// Type guards for SDK message types
function isTextBlock(b: unknown): b is TextBlock { return (b as any)?.type === "text"; }
function isThinkingBlock(b: unknown): b is ThinkingBlock { return (b as any)?.type === "thinking"; }
function isToolUseBlock(b: unknown): b is ToolUseBlock { return (b as any)?.type === "tool_use"; }
function isToolResultBlock(b: unknown): b is ToolResultBlock { return (b as any)?.type === "tool_result"; }
function isResultMessage(m: unknown): m is ResultMessage { return (m as any)?.type === "result"; }
```

### Gemini Plugin — spawn + readline

```ts
// src/plugins/gemini/plugin.ts

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CliPlugin, ExecuteInput, PluginContext } from "../types.js";
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
    // Prepare launch config — handles MCP injection + cleanup
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
      // readline gives us clean line-by-line async iteration over
      // the NDJSON stdout — no manual buffer management needed.
      const rl = createInterface({ input: child.stdout! });

      for await (const line of rl) {
        const events = parser.pushLine(line);
        for (const ev of events) yield ev;
      }

      // Process exited — emit final events
      const code = await new Promise<number | null>(resolve =>
        child.once("close", resolve),
      );
      yield* parser.finish(code ?? 1);
    } finally {
      // Clean up injected MCP config
      await launch.cleanup?.();
    }
  }

  async listConversations(): Promise<ConversationInfo[]> {
    // Spawn `gemini --list-sessions`, parse output
    return [];
  }
}
```

The event parser is a stateful class that tracks text block state — but
with no nested closures, no `nonlocal`, just class fields:

```ts
// src/plugins/gemini/event-parser.ts

import type { BotEvent } from "../../stream/events.js";
import { cleanToolName } from "../util.js";

export class GeminiEventParser {
  private blockSeq = 0;
  private textBlockId: string | null = null;
  private sessionId: string | undefined;

  constructor(initialSessionId?: string) {
    this.sessionId = initialSessionId;
  }

  private nextId(): string {
    return `b${this.blockSeq++}`;
  }

  private closeTextBlock(): BotEvent[] {
    if (!this.textBlockId) return [];
    const ev: BotEvent = {
      type: "block_close",
      pluginId: "gemini",
      ts: Date.now(),
      blockId: this.textBlockId,
    };
    this.textBlockId = null;
    return [ev];
  }

  pushLine(line: string): BotEvent[] {
    if (!line.trim()) return [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return []; // skip malformed lines
    }

    const ts = Date.now();
    const events: BotEvent[] = [];

    switch (parsed.type) {
      case "init":
        this.sessionId = (parsed.session_id as string) ?? this.sessionId;
        break;

      case "message":
        if (parsed.role === "user") break;
        if (parsed.role === "assistant") {
          const content = parsed.content as string;
          if (!content) break;

          if (!this.textBlockId) {
            this.textBlockId = this.nextId();
            events.push({
              type: "block_open", pluginId: "gemini", ts,
              block: { id: this.textBlockId, kind: "text" },
            });
          }
          events.push({
            type: "block_delta", pluginId: "gemini", ts,
            blockId: this.textBlockId, delta: content,
          });
        }
        break;

      case "tool_use":
        events.push(...this.closeTextBlock());
        events.push({
          type: "block_emit", pluginId: "gemini", ts,
          block: {
            id: this.nextId(),
            kind: "tool_use",
            toolName: cleanToolName((parsed.tool_name as string) ?? "unknown"),
            toolId: (parsed.tool_id as string) ?? "",
            input: (parsed.parameters as Record<string, unknown>) ?? {},
          },
        });
        break;

      case "tool_result":
        events.push(...this.closeTextBlock());
        events.push({
          type: "block_emit", pluginId: "gemini", ts,
          block: {
            id: this.nextId(),
            kind: "tool_result",
            toolUseId: (parsed.tool_id as string) ?? "",
            isError: parsed.status === "error",
            content: {
              format: "text",
              text: (parsed.output as string) ?? "",
            },
          },
        });
        break;

      case "result":
        events.push(...this.closeTextBlock());
        events.push({
          type: "complete", pluginId: "gemini", ts,
          sessionId: this.sessionId,
          durationMs: (parsed.stats as Record<string, unknown>)?.duration_ms as number | undefined,
        });
        break;
    }

    return events;
  }

  *finish(exitCode: number | null): Generator<BotEvent> {
    yield* this.closeTextBlock();
    // If no result event was emitted, synthesize one
    // (caller checks whether a CompleteEvent was already yielded)
  }
}
```

### Codex Plugin — SDK Direct

Codex CLI is TypeScript-native. Like Claude, use its SDK directly:

```ts
// src/plugins/codex/plugin.ts

import type { CliPlugin, ExecuteInput, PluginContext } from "../types.js";
import type { BotEvent } from "../../stream/events.js";
import { mapCodexEvent } from "./event-mapper.js";

// Codex SDK types (hypothetical — adapt to actual SDK when available)
export interface CodexClient {
  runTurn(input: {
    workdir: string;
    prompt: string;
    sessionId?: string;
  }): AsyncIterable<CodexSdkEvent>;
  listSessions(workdir?: string): Promise<Array<{
    id: string;
    title: string;
    updatedAt: string;
  }>>;
}

export class CodexPlugin implements CliPlugin {
  readonly id = "codex";
  readonly displayName = "Codex";

  constructor(private readonly client: CodexClient) {}

  async *execute(
    input: ExecuteInput,
    ctx: PluginContext,
  ): AsyncGenerator<BotEvent> {
    for await (const sdkEvent of this.client.runTurn({
      workdir: input.workdir,
      prompt: input.message,
      sessionId: input.sessionId,
    })) {
      yield mapCodexEvent(sdkEvent);
    }
  }

  async listConversations(workdir?: string) {
    const sessions = await this.client.listSessions(workdir);
    return sessions.map(s => ({
      id: s.id,
      title: s.title,
      timestamp: new Date(s.updatedAt),
    }));
  }
}
```

### MCP Config Injection Per CLI

| CLI | Injection Method | Clean? |
|---|---|---|
| **Claude** | SDK option: `mcpServers` in `ClaudeAgentOptions` | Yes — first-party |
| **Codex** | SDK client config or `--mcp-server` flag | Yes |
| **Gemini** | Ephemeral `.gemini/settings.json` or env var (when supported) | Workaround |

For Gemini, the `prepareGeminiLaunch` helper isolates the filesystem hack:

```ts
// src/plugins/gemini/mcp-config.ts

import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
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
  const gitRoot = await findGitRoot(opts.workdir) ?? opts.workdir;
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
    } catch { /* best effort */ }
  };

  return { args: [], env, cleanup };
}
```

---

## 3. Process Manager with MCP

### Types

```ts
// src/process-manager/types.ts

import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type ProcessStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface ManagedProcess {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  status: ProcessStatus;
  pid?: number;
  exitCode?: number | null;
  startedAt: number;
  stoppedAt?: number;
  stdout: RingBuffer;
  stderr: RingBuffer;
  /** @internal */
  child?: ChildProcessWithoutNullStreams;
}
```

### RingBuffer

```ts
// src/process-manager/types.ts (continued)

export class RingBuffer {
  private chunks: string[] = [];
  private chars = 0;
  private _seq = 0;

  constructor(public readonly maxChars = 100_000) {}

  append(data: string): void {
    if (!data) return;
    this.chunks.push(data);
    this.chars += data.length;
    this._seq += 1;
    while (this.chars > this.maxChars && this.chunks.length > 0) {
      const evicted = this.chunks.shift()!;
      this.chars -= evicted.length;
    }
  }

  get seq(): number { return this._seq; }

  tail(n = 2000): string {
    let remaining = n;
    const out: string[] = [];
    for (let i = this.chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const c = this.chunks[i];
      if (c.length <= remaining) {
        out.push(c);
        remaining -= c.length;
      } else {
        out.push(c.slice(c.length - remaining));
        remaining = 0;
      }
    }
    return out.reverse().join("");
  }
}
```

### ProcessSupervisor

```ts
// src/process-manager/supervisor.ts

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { RingBuffer, type ManagedProcess } from "./types.js";

export class ProcessSupervisor {
  private readonly processes = new Map<string, ManagedProcess>();

  async start(input: {
    name: string;
    command: string;
    args?: string[];
    cwd: string;
    env?: Record<string, string>;
  }): Promise<ManagedProcess> {
    const existing = this.processes.get(input.name);
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      return existing;
    }

    const managed: ManagedProcess = {
      name: input.name,
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd,
      env: input.env,
      status: "starting",
      startedAt: Date.now(),
      stdout: new RingBuffer(),
      stderr: new RingBuffer(),
    };
    this.processes.set(input.name, managed);

    const child = spawn(input.command, managed.args, {
      cwd: managed.cwd,
      env: { ...process.env, ...managed.env },
      stdio: ["ignore", "pipe", "pipe"],
      // Create new process group on Unix for clean tree kill.
      // On Windows, detached + tree-kill handles this.
      detached: process.platform !== "win32",
    });

    managed.child = child;
    managed.pid = child.pid;
    managed.status = "running";

    child.stdout.on("data", (buf: Buffer) => managed.stdout.append(buf.toString()));
    child.stderr.on("data", (buf: Buffer) => managed.stderr.append(buf.toString()));
    child.on("exit", (code) => {
      managed.exitCode = code;
      managed.stoppedAt = Date.now();
      if (managed.status !== "stopping") {
        managed.status = code === 0 ? "stopped" : "failed";
      }
    });

    return managed;
  }

  async stop(name: string, force = false): Promise<ManagedProcess> {
    const p = this.processes.get(name);
    if (!p) throw new Error(`No process named '${name}'`);
    if (!p.child || p.status === "stopped" || p.status === "failed") return p;

    p.status = "stopping";
    const pid = p.child.pid!;

    if (process.platform === "win32") {
      // Windows: use tree-kill
      const treeKill = (await import("tree-kill")).default;
      await new Promise<void>(resolve => treeKill(pid, force ? "SIGKILL" : "SIGTERM", () => resolve()));
    } else {
      // Unix: kill the process group directly (equivalent to Python's os.killpg)
      const sig = force ? "SIGKILL" : "SIGTERM";
      try { process.kill(-pid, sig); } catch { /* already dead */ }

      if (!force) {
        // Wait for graceful shutdown, then escalate
        await sleep(10_000);
        if (!p.child.killed) {
          try { process.kill(-pid, "SIGKILL"); } catch { /* already dead */ }
        }
      }
    }

    p.status = "stopped";
    return p;
  }

  list(): ManagedProcess[] {
    return [...this.processes.values()];
  }

  getOutput(name: string, tail = 2000) {
    const p = this.processes.get(name);
    if (!p) throw new Error(`No process named '${name}'`);
    return {
      name: p.name,
      status: p.status,
      pid: p.pid,
      stdout: p.stdout.tail(tail),
      stderr: p.stderr.tail(tail),
      stdoutSeq: p.stdout.seq,
      stderrSeq: p.stderr.seq,
    };
  }

  async stopAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.allSettled(names.map(n => this.stop(n)));
  }
}
```

**Trade-off: `process.kill(-pid)` vs `tree-kill`**

| | Unix `process.kill(-pid)` | `tree-kill` |
|---|---|---|
| Mechanism | OS-level process group kill (POSIX) | Walks `/proc` or `ps` to find children |
| Speed | Instant — single syscall | Slower — spawns `ps` subprocess |
| Reliability | Guaranteed if `detached: true` set at spawn | Heuristic — can miss orphans |
| Cross-platform | Unix only | Windows + Unix |
| Dependencies | None | npm package |

**Decision**: Use `process.kill(-pid)` on Unix (same as Python's `os.killpg`),
fall back to `tree-kill` on Windows only. This gives us the same reliability as
the Python implementation on the primary deployment target (macOS/Linux).

### MCP Server

```ts
// src/process-manager/mcp-server.ts

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
      env: z.record(z.string()).optional().describe("Extra env vars"),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await supervisor.start(input)) }],
    }),
  );

  server.tool(
    "stop_process",
    "Stop a managed process. SIGTERM → wait → SIGKILL.",
    {
      name: z.string(),
      force: z.boolean().optional(),
    },
    async ({ name, force }) => ({
      content: [{ type: "text", text: JSON.stringify(await supervisor.stop(name, force)) }],
    }),
  );

  server.tool(
    "list_processes",
    "List all managed processes with status.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(supervisor.list()) }],
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
      content: [{ type: "text", text: JSON.stringify(supervisor.getOutput(name, tail)) }],
    }),
  );

  return server;
}
```

---

## 4. Platform-Agnostic Rendering

### Platform Interface

Each chat platform exposes the same contract. The `constraints` field lets
the stream coordinator adapt its behavior without `if (discord) ... else if (telegram)`:

```ts
// src/platform/types.ts

export interface PlatformConstraints {
  /** Max characters per message. */
  charLimit: number;
  /** Can we edit a sent message? */
  supportsEdit: boolean;
  /** Minimum ms between consecutive edits to the same message. */
  editRateLimitMs: number;
  /** Can we create threads / replies? */
  supportsThreads: boolean;
}

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface OutboundMessage {
  text: string;
  parseMode?: "markdown" | "html" | "plain";
}

export interface ChatPlatform {
  readonly name: string;
  readonly constraints: PlatformConstraints;

  send(channelId: string, msg: OutboundMessage): Promise<MessageRef>;
  edit(ref: MessageRef, msg: OutboundMessage): Promise<void>;
  delete?(ref: MessageRef): Promise<void>;
}
```

### Platform Implementations

```ts
// src/platform/discord.ts
import { Client, TextChannel } from "discord.js";
import type { ChatPlatform, PlatformConstraints, MessageRef, OutboundMessage } from "./types.js";

export class DiscordPlatform implements ChatPlatform {
  readonly name = "discord";
  readonly constraints: PlatformConstraints = {
    charLimit: 1900,     // leave 100 char buffer under Discord's 2000 limit
    supportsEdit: true,
    editRateLimitMs: 500, // ~2 edits/sec
    supportsThreads: true,
  };

  constructor(private readonly client: Client) {}

  async send(channelId: string, msg: OutboundMessage): Promise<MessageRef> {
    const channel = await this.client.channels.fetch(channelId) as TextChannel;
    const sent = await channel.send(msg.text);
    return { channelId, messageId: sent.id };
  }

  async edit(ref: MessageRef, msg: OutboundMessage): Promise<void> {
    const channel = await this.client.channels.fetch(ref.channelId) as TextChannel;
    const message = await channel.messages.fetch(ref.messageId);
    await message.edit(msg.text);
  }
}
```

```ts
// src/platform/telegram.ts — sketch
export class TelegramPlatform implements ChatPlatform {
  readonly name = "telegram";
  readonly constraints: PlatformConstraints = {
    charLimit: 4096,
    supportsEdit: true,
    editRateLimitMs: 1000,
    supportsThreads: false,
  };
  // ... grammY / Telegraf implementation
}
```

```ts
// src/platform/whatsapp.ts — sketch
export class WhatsAppPlatform implements ChatPlatform {
  readonly name = "whatsapp";
  readonly constraints: PlatformConstraints = {
    charLimit: 65536,      // WhatsApp has generous text limits
    supportsEdit: false,   // No edit API in most flows
    editRateLimitMs: 0,    // N/A — no edits
    supportsThreads: false,
  };
  // When supportsEdit is false, the StreamCoordinator will
  // accumulate content and send new messages instead of editing.
}
```

### Renderer Interface

The renderer converts `BotEvent` blocks into platform-native formatted strings.
Separate from the platform adapter (which handles transport):

```ts
// src/rendering/types.ts

import type { BlockEmitEvent, BlockKind } from "../stream/events.js";

export interface Renderer {
  /** Render accumulated content for a streaming text/thinking block. */
  renderStreaming(kind: "text" | "thinking", content: string): string;

  /** Render a one-shot emit event. */
  renderEmit(event: BlockEmitEvent): string;

  /** Render a tool-use header line. */
  renderToolHeader(toolName: string, input: Record<string, unknown>): string;

  /** Render a truncated tool result. */
  renderToolResult(content: string, isError: boolean): string;

  /** Suppress embed previews (platform-specific, optional). */
  suppressEmbeds?(text: string): string;
}
```

```ts
// src/rendering/discord-renderer.ts

import type { Renderer } from "./types.js";
import type { BlockEmitEvent } from "../stream/events.js";

const BARE_URL_RE = /(?<![<(])(https?:\/\/\S+)/g;

export class DiscordRenderer implements Renderer {
  renderStreaming(kind: "text" | "thinking", content: string): string {
    if (kind === "thinking") {
      const preview = content.slice(0, 80).replace(/\n/g, " ");
      return `\n-# 💭 ${preview}${content.length > 80 ? "…" : ""}\n`;
    }
    return this.suppressEmbeds(content);
  }

  renderEmit(event: BlockEmitEvent): string {
    switch (event.block.kind) {
      case "tool_use":
        return this.renderToolHeader(event.block.toolName, event.block.input);
      case "tool_result": {
        const text = event.block.content.format === "text"
          ? event.block.content.text
          : event.block.content.format === "parts"
            ? event.block.content.parts.map(p => p.text).join("\n")
            : "";
        return this.renderToolResult(text, event.block.isError);
      }
      case "error":
        return `\n❌ **Error:** ${event.block.message}\n`;
      case "system":
        return `\n-# ℹ️ ${event.block.subtype}: ${event.block.message}\n`;
    }
  }

  renderToolHeader(toolName: string, input: Record<string, unknown>): string {
    if (Object.keys(input).length === 0) return `-# 🔧 ${toolName}`;
    let preview = Object.entries(input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (preview.length > 80) preview = preview.slice(0, 80) + "…";
    return `-# 🔧 ${toolName}(${preview})`;
  }

  renderToolResult(content: string, isError: boolean): string {
    if (!content) return "";
    const prefix = isError ? "⚠️ " : "";
    const lines = content.split("\n");
    let truncated = lines.length > 6
      ? lines.slice(0, 6).join("\n") + `\n… (${lines.length - 6} more lines)`
      : content;
    if (truncated.length > 400) {
      truncated = truncated.slice(0, 400) + "\n… (truncated)";
    }
    return `${prefix}\`\`\`\n${truncated}\n\`\`\``;
  }

  suppressEmbeds(text: string): string {
    return text.replace(BARE_URL_RE, "<$1>");
  }
}
```

### Stream Coordinator

The stream coordinator is now platform-agnostic. It takes a `ChatPlatform`
and a `Renderer`, never imports discord.js or any platform SDK:

```ts
// src/stream/stream-coordinator.ts

import type { BotEvent, BlockEmitEvent, CompleteEvent, FatalErrorEvent } from "./events.js";
import type { ChatPlatform, MessageRef } from "../platform/types.js";
import type { Renderer } from "../rendering/types.js";

interface OpenBlock {
  kind: "text" | "thinking";
  content: string;
  renderStart: number; // position in buffer where this block's render begins
}

/**
 * Unclosed code fence detection for safe message splitting.
 * Returns the fence line (e.g. "```json") if unclosed, null otherwise.
 */
function unclosedCodeFence(text: string): string | null {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      fence = fence === null ? stripped : null;
    }
  }
  return fence;
}

export class StreamCoordinator {
  constructor(
    private readonly platform: ChatPlatform,
    private readonly renderer: Renderer,
  ) {}

  async run(
    channelId: string,
    events: AsyncIterable<BotEvent>,
  ): Promise<CompleteEvent | FatalErrorEvent | undefined> {
    const { charLimit, supportsEdit, editRateLimitMs } = this.platform.constraints;

    let buffer = "";
    let msg: MessageRef | undefined;
    let lastEdit = 0;
    let result: CompleteEvent | FatalErrorEvent | undefined;

    const openBlocks = new Map<string, OpenBlock>();

    const flush = async (force = false) => {
      if (!buffer) return;
      const now = Date.now();
      if (!force && now - lastEdit < editRateLimitMs) return;

      const text = buffer.slice(0, charLimit);
      if (!msg || !supportsEdit) {
        msg = await this.platform.send(channelId, { text, parseMode: "markdown" });
      } else {
        await this.platform.edit(msg, { text, parseMode: "markdown" });
      }
      lastEdit = Date.now();
    };

    const split = async () => {
      while (buffer.length > charLimit) {
        const overflow = buffer.slice(charLimit);
        buffer = buffer.slice(0, charLimit);

        // Repair unclosed code fences before splitting
        const fence = unclosedCodeFence(buffer);
        if (fence) buffer += "\n```";

        await flush(true);
        msg = undefined; // next flush creates a new message
        buffer = fence ? `${fence}\n${overflow}` : overflow;
      }
    };

    const finalize = async () => {
      if (buffer) {
        await split();
        await flush(true);
      }
      msg = undefined;
      buffer = "";
    };

    for await (const ev of events) {
      switch (ev.type) {
        case "block_open":
          openBlocks.set(ev.block.id, {
            kind: ev.block.kind,
            content: "",
            renderStart: buffer.length,
          });
          break;

        case "block_delta": {
          const ob = openBlocks.get(ev.blockId);
          if (!ob) break;
          ob.content += ev.delta;
          const rendered = this.renderer.renderStreaming(ob.kind, ob.content);
          buffer = buffer.slice(0, ob.renderStart) + rendered;
          await split();
          await flush();
          break;
        }

        case "block_close":
          openBlocks.delete(ev.blockId);
          break;

        case "block_emit":
          if (ev.block.kind === "tool_use") {
            // Each tool call gets its own message
            await finalize();
            buffer = this.renderer.renderToolHeader(ev.block.toolName, ev.block.input);
            await flush();
          } else if (ev.block.kind === "tool_result") {
            const text = ev.block.content.format === "text" ? ev.block.content.text
              : ev.block.content.format === "parts" ? ev.block.content.parts.map(p => p.text).join("\n")
              : "";
            buffer += "\n" + this.renderer.renderToolResult(text, ev.block.isError);
            await finalize(); // tool card done — next content gets fresh message
          } else {
            buffer += this.renderer.renderEmit(ev);
            await split();
            await flush();
          }
          break;

        case "complete":
          result = ev;
          break; // fall through to final flush

        case "fatal_error":
          buffer += `\n❌ ${ev.error.message}\n`;
          result = ev;
          break;
      }

      if (ev.type === "complete" || ev.type === "fatal_error") break;
    }

    await finalize();
    return result;
  }
}
```

### What Changed vs Python

| Python (`stream_coordinator.py`) | TypeScript (`StreamCoordinator`) |
|---|---|
| `import discord` at top level | Zero platform imports — takes `ChatPlatform` interface |
| `channel: discord.abc.Messageable` parameter | `channelId: string` + `ChatPlatform.send/edit` |
| `nonlocal buffer, current_msg, last_edit` closures | Class fields or local variables in `run()` |
| `stream_to_discord()` function name | `StreamCoordinator.run()` — platform-agnostic name |
| Hardcoded `DISCORD_CHAR_LIMIT = 1900` | `this.platform.constraints.charLimit` |
| Hardcoded `MIN_EDIT_INTERVAL = 0.5` | `this.platform.constraints.editRateLimitMs` |
| WhatsApp would need a totally separate coordinator | Same coordinator, just `supportsEdit: false` → sends new messages |

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| Event model | Discriminated unions, not classes | Exhaustive `switch`, zero-cost at runtime, works with `JSON.parse` |
| Plugin interface | TypeScript interface, not abstract class | No inheritance hierarchy needed; plugins are leaf implementations |
| Process group kill | `process.kill(-pid)` on Unix, `tree-kill` on Windows | Same reliability as Python on the primary target (macOS/Linux) |
| MCP SDK | `@modelcontextprotocol/sdk` with Zod schemas | Official SDK, type-safe tool definitions |
| Claude integration | `@anthropic-ai/claude-code` SDK direct | No subprocess, no output parsing, proper streaming types |
| Gemini integration | `child_process.spawn` + `readline` | Gemini CLI has no TS SDK; NDJSON streaming is natural with readline |
| Platform abstraction | `ChatPlatform` interface with `PlatformConstraints` | One coordinator works across Discord, Telegram, WhatsApp |
| Renderer vs Platform | Separate interfaces | Renderer = "how does a tool header look?"; Platform = "send this string to the user" |
| Formatter method signatures | Take typed event objects, not `(content, metadata)` | No more `metadata.get("tool_name", "tool")` |

## Migration Notes

This is a clean rewrite, not a port. Key differences from the Python codebase:

1. **No `asyncio.Queue` bridge** — TypeScript async generators work across Promise boundaries without cancel-scope issues. The ~15 lines of boilerplate per plugin disappear entirely.

2. **No `nonlocal` state management** — The Gemini event parser is a class with fields instead of triple-nested closures with `nonlocal`.

3. **No untyped metadata dictionaries** — Every consumer uses typed fields. Adding a new event kind is a compile error everywhere it needs handling.

4. **Platform-agnostic from day one** — The Python implementation grew organically around Discord. The TypeScript version separates platform transport from rendering from stream coordination.

5. **Process manager uses the same kill strategy** — `detached: true` + `process.kill(-pid)` is the Node.js equivalent of `os.setsid` + `os.killpg`. No behavior change on macOS/Linux.
