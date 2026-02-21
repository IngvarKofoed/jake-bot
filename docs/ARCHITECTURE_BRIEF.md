# jake-bot Architecture Brief

Multi-model Discord bot (Claude, Gemini, Codex) with a platform-agnostic streaming architecture.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document with code examples.

## Tech Stack

- **Runtime:** Node.js with TypeScript (ES2022, Node16 modules, ESM)
- **Discord:** discord.js v14
- **AI CLIs:** @anthropic-ai/claude-code SDK (direct), Gemini CLI (spawn + NDJSON), Codex SDK (hypothetical)
- **MCP:** @modelcontextprotocol/sdk for process manager
- **Validation:** zod

## Project Structure

```
src/
  index.ts                 # Bootstrap: wires core objects and starts adapter
  config.ts                # env/config loading (dotenv)

  adapters/
    types.ts               # BotAdapter interface
    discord.ts             # Discord inbound: Client, slash commands, event listeners

  stream/
    events.ts              # BotEvent discriminated union — the core type system
    stream-coordinator.ts  # platform-agnostic buffering, rate limiting, message splitting

  platform/
    types.ts               # ChatPlatform + PlatformConstraints interfaces
    discord.ts             # discord.js send/edit implementation
    telegram.ts            # stub
    whatsapp.ts            # stub

  rendering/
    types.ts               # Renderer interface (format-agnostic)
    discord-renderer.ts    # Discord markdown: tool cards, thinking previews, embed suppression
    telegram-renderer.ts   # stub (HTML parse mode)
    whatsapp-renderer.ts   # stub (plain text)

  plugins/
    types.ts               # CliPlugin interface, ExecuteInput, PluginContext
    util.ts                # cleanToolName() — MCP prefix → human-readable
    claude/
      plugin.ts            # Claude Code SDK — direct async iteration, no subprocess
      event-mapper.ts      # SDK messages → BotEvent (pure function)
    gemini/
      plugin.ts            # Gemini CLI — child_process spawn + readline
      event-parser.ts      # NDJSON line parser → BotEvent (stateful class)
      mcp-config.ts        # Ephemeral .gemini/settings.json injection for MCP
    codex/
      plugin.ts            # Codex SDK plugin (hypothetical client interface)
      event-mapper.ts      # stub

  core/
    router.ts              # message → plugin → StreamCoordinator pipeline
    active-conversations.ts # (userId, channelId) → {pluginId, workdir, sessionId}
    plugin-registry.ts     # plugin lookup by ID

  process-manager/
    types.ts               # ManagedProcess, ProcessStatus, RingBuffer
    supervisor.ts          # spawn, drain, kill process trees (process groups on Unix)
    mcp-server.ts          # MCP tool definitions (start/stop/restart/list/get_output)
    main.ts                # standalone SSE-based HTTP daemon on :8901

  util/
    git.ts                 # findGitRoot() — used by Gemini MCP config injection
```

## Key Architecture Patterns

### BotEvent Discriminated Union
All plugin output flows through a single typed event stream (`src/stream/events.ts`). Event types: `block_open`, `block_delta`, `block_close`, `block_emit`, `complete`, `fatal_error`. Emit events further discriminate on `block.kind`: `tool_use`, `tool_result`, `error`, `system`.

### Plugin System
Plugins implement `CliPlugin` — an async generator interface that yields `BotEvent`s. No queue bridges, no async workarounds. Adding a new CLI = one plugin file + one event mapper.

### Platform Abstraction
`ChatPlatform` (transport: send/edit) and `Renderer` (formatting) are separate interfaces. `StreamCoordinator` uses `PlatformConstraints` (charLimit, supportsEdit, editRateLimitMs) to adapt behavior per platform — no platform-specific imports or text formatting in the coordinator. All formatting (tool headers, errors, footers) is delegated to the `Renderer`.

### Process Manager
Long-running processes managed via MCP protocol. `ProcessSupervisor` handles spawn + drain + kill (process groups on Unix, tree-kill on Windows). Exposed as an SSE-based MCP HTTP server that all CLI plugins connect to.

## Data Flow

```
User message → Discord slash command / follow-up message
  → DiscordAdapter (event listeners)
    → Router.route()
      → ActiveConversations lookup
      → Plugin.execute() → AsyncGenerator<BotEvent>
        → StreamCoordinator.run()
          → Renderer formats each event
          → Platform sends/edits messages
          → Returns CompleteEvent with sessionId
      → Session ID saved for follow-up turns
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start bot with tsx (hot reload) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled output |
| `npm run process-manager` | Standalone process manager daemon |

## Environment Variables

See `.env.example`. Required: `DISCORD_TOKEN`, `DISCORD_APP_ID`.

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_TOKEN` | — | Discord bot token (required) |
| `DISCORD_APP_ID` | — | Discord application ID (required) |
| `DEFAULT_WORKDIR` | `process.cwd()` | Default working directory for plugins |
| `PROCESS_MANAGER_PORT` | `8901` | Process manager HTTP port |
| `PROCESS_MANAGER_URL` | `http://localhost:8901/sse` | Process manager endpoint URL |
| `CLAUDE_MAX_TURNS` | `30` | Max agentic turns per Claude invocation |
| `CLAUDE_MAX_BUDGET` | `5.0` | Max USD budget per Claude invocation |
| `GEMINI_BIN` | `gemini` | Path to Gemini CLI binary |
