# Changelog

## 1. TypeScript rewrite — initial implementation

- Scaffolded project (package.json, tsconfig.json, ESM config) and installed all dependencies
- Implemented full BotEvent discriminated union, plugin system (Claude, Gemini, Codex), and process manager with MCP server
- Built platform-agnostic StreamCoordinator with Discord/Telegram/WhatsApp renderer and platform stubs
- Added core routing layer: ActiveConversations, PluginRegistry, Router, config loading
- Created entry points: Discord bot with 7 slash commands (`src/index.ts`) and standalone MCP HTTP daemon (`src/process-manager/main.ts`)

## 2. Split CLAUDE.md into project instructions + architecture brief

- Moved architecture content from CLAUDE.md to `docs/ARCHITECTURE_BRIEF.md` with enriched data flow, env variable table, and pattern descriptions
- Slimmed CLAUDE.md to concise project instructions and conventions

## 3. Fix misleading ENOENT when workdir doesn't exist

- Validate `workdir` exists in `ActiveConversations.start()` and `.resume()` before passing to plugins
- A non-existent cwd causes `spawn` to throw ENOENT blaming the executable, which is misleading

## 4. Fix Claude responses not appearing in Discord

- The Claude SDK yields `SDKAssistantMessage` with content at `msg.message.content`, but the event mapper was checking `msg.content` — so all assistant text, tool use, and thinking blocks were silently dropped
- Updated `mapClaudeMessage` to extract content from the correct path via `extractContent()` helper

## 5. Add timestamped BotEvent logging

- Added `src/core/logger.ts` with ISO-timestamped `log.info/warn/error(tag, msg)` helper
- Log all BotEvents in `StreamCoordinator` (skip `block_delta` to avoid noise; report content length at `block_close`)
- Log routed messages in `Router` with user/channel/plugin context

## 6. Centralize all logging through the timestamped logger

- Moved `logBotEvent` from `stream-coordinator.ts` into `src/core/logger.ts`
- Replaced all raw `console.log/warn/error` calls in `index.ts` and `process-manager/main.ts` with `log.info/warn/error`
- Updated `PluginContext.logger` to use the `Logger` interface
- Only `src/core/logger.ts` touches `console` now — single point of control

## 7. Extract Discord adapter from index.ts

- Created `src/adapters/types.ts` with `BotAdapter` interface and `src/adapters/discord.ts` with `DiscordAdapter` class
- Moved all Discord-specific code (Client, slash commands, handlers, event listeners) from `index.ts` into `DiscordAdapter`
- Rewrote `index.ts` as pure bootstrap: loads config, registers plugins, creates core objects, starts adapter — zero discord.js imports
- Updated CLAUDE.md convention and architecture docs to reflect new `adapters/` layer

## 8. Add conversation lifecycle logging to ActiveConversations

- Log start, end, resume, and session ID capture in `ActiveConversations` so inbound adapter calls are visible in the core

## 9. Improve pre-execute logging in Router

- Enhanced router log before `plugin.execute()` to include session ID (or "new"), workdir, and message length

## 10. Slash commands no longer send an initial message to the plugin

- Removed required `message` option from `/claude`, `/gemini`, and `/codex` slash commands
- Start command now only opens the conversation; the user's first channel message triggers the plugin

## 11. Resolve relative workdir paths against home directory

- Relative paths (e.g. `private/jake-bot`) are now resolved against `homedir()` in `ActiveConversations`
- Default workdir fallback changed from `process.cwd()` to `homedir()` in config

## 12. Show typing indicator while waiting for AI response

- Added optional `sendTyping` method to `ChatPlatform` interface
- Implemented `sendTyping` in `DiscordPlatform` via `channel.sendTyping()`
- `StreamCoordinator` triggers typing on run start and after each `finalize()` (tool use gaps), stops on message send or stream end

## 13. Fix tool usage and text running together in Discord

- Tool header was flushed but not finalized, so subsequent text was edited into the same message
- Changed `tool_use` handling to `finalize()` after setting the buffer, ensuring the tool header is sent as its own message
- Cleaned up `tool_result` to skip sending when the rendered result is empty

## 14. Fix typing indicator stuck after stream completes

- `stopTyping()` was called before `finalize()`, but `finalize()` restarts the typing timer — so the indicator was never cleared
- Swapped the order: `finalize()` first, then `stopTyping()`

## 15. Process manager auto-starts jake-bot

- Added `pipeOutput` flag to `ManagedProcess` type and `supervisor.start()` input
- When `pipeOutput` is true, stdout/stderr from the child process are piped to the parent's console
- Process manager auto-starts jake-bot with `pipeOutput: true` on startup
- `restart_process` MCP tool preserves `pipeOutput` across restarts
- Enables single-command startup: `npm run process-manager` runs both the MCP daemon and jake-bot

## 16. Switch process manager MCP from SSE to Streamable HTTP

- Replaced `SSEServerTransport` (`/sse` + `/messages`) with stateless `StreamableHTTPServerTransport` on `/mcp`
- Uses `sessionIdGenerator: undefined` (stateless mode) matching the original Python `stateless_http=True`
- Each POST to `/mcp` creates a fresh transport+server — no session tracking needed
- Fixes CLI plugins (Claude, Gemini) which were already configured for `http://localhost:8901/mcp`

## 17. Migrate to `@anthropic-ai/claude-agent-sdk` + zod v4

- Replaced `@anthropic-ai/claude-code` with `@anthropic-ai/claude-agent-sdk` — fixes stale terms-acceptance check (exit code 1)
- Upgraded zod from v3 to v4; fixed breaking `z.record()` call in `mcp-server.ts` (now requires explicit key+value types)
- Removed debug stderr and MCP config logging from Claude plugin

## 18. Show response duration and move formatting out of StreamCoordinator

- Added `renderFatalError(message)` and optional `renderFooter(durationMs, costUsd)` to `Renderer` interface
- Implemented in all three renderers (Discord, Telegram, WhatsApp)
- `StreamCoordinator` no longer contains any formatting — delegates fatal errors and completion footer to the renderer
- Discord footer renders duration as subtext + italic (`-# *5.2s*`)

## 19. Fix typing indicator gaps and post-completion persistence

- Typing now runs continuously from start to completion — no longer stopped/restarted at content boundaries
- Removed `stopTyping()` from `flush()` so the interval keeps running during streaming
- Removed `startTyping()` from `finalize()` so typing isn't re-fired after the final message
- Re-fire `sendTyping()` immediately after each `send()` since Discord auto-clears typing on message send
- Added `stopTyping` to `ChatPlatform` interface; Discord implementation sends+deletes a zero-width space message to force-clear the indicator
