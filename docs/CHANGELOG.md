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

## 20. Sync architecture docs with code (3-model audit)

- Fixed `/codex` slash command crash — adapter now checks plugin is registered before starting conversation
- Updated all `@anthropic-ai/claude-code` references → `@anthropic-ai/claude-agent-sdk` in both docs; rewrote event-mapper code example to show structural interfaces and `extractContent()` helper
- Fixed process manager transport docs: SSE → Streamable HTTP, `/sse` → `/mcp`, added `restart_process` tool
- Documented `stopTyping` on `ChatPlatform` and the typing-indicator lifecycle in `StreamCoordinator`
- Updated `PluginContext.logger` type, `DEFAULT_WORKDIR` default, `pipeOutput` field, `logger.ts` in project structure, and Gemini `finish()` fatal_error logic

## 21. Add /clear slash command

- New `/clear` command resets conversation history without switching plugin or workdir — replaces the `/end` + `/claude` two-step
- Added `ActiveConversations.clear()` method that deletes the old session and starts a fresh one in place
- Updated "already in conversation" error to mention `/clear` alongside `/end`

## 19. Fix typing indicator gaps and post-completion persistence

- Typing now runs continuously from start to completion — no longer stopped/restarted at content boundaries
- Removed `stopTyping()` from `flush()` so the interval keeps running during streaming
- Removed `startTyping()` from `finalize()` so typing isn't re-fired after the final message
- Re-fire `sendTyping()` immediately after each `send()` since Discord auto-clears typing on message send
- Added `stopTyping` to `ChatPlatform` interface; Discord implementation sends+deletes a zero-width space message to force-clear the indicator

## 22. Stop truncating thinking message in Discord

- Removed 80-character truncation from thinking preview in `DiscordRenderer.renderStreaming()` — full thinking text is now shown

## 23. Add voice-controlled web adapter

- New `WebAdapter` serves a self-contained HTML page with browser-native Web Speech API (STT + TTS) — 100% hands-free, zero external dependencies
- `WebPlatform` bridges `StreamCoordinator` send/edit calls to per-session `EventEmitter`s consumed by SSE endpoints
- `WebRenderer` outputs plain text suitable for TTS readback
- Voice commands ("start claude", "end conversation", "switch to gemini") parsed before routing; auto-starts default plugin if no active conversation
- `ADAPTER` env var selects `"discord"`, `"web"`, or `"both"`; dynamic imports keep discord.js out of web-only builds

## 24. Server-side TTS via Google Cloud Text-to-Speech

- Replaced browser `speechSynthesis` with Google Cloud TTS (Standard model) for higher quality voice output
- New `src/core/google-tts.ts` — REST API client with sentence splitting and pipelined concurrent synthesis (up to 3 in-flight) for minimum time-to-first-audio
- Audio chunks stream to the browser via existing SSE connection as `audio` events; client queues and plays sequentially
- Graceful fallback: TTS silently disabled when `GOOGLE_API_KEY` is absent
- TTS toggle, Escape-to-cancel, and mic pause/resume during playback all preserved

## 25. Persist conversation sessions across bot restarts

- `ActiveConversations` now loads/saves a JSON file (`~/.jake-bot/sessions.json`) on every mutation so conversations survive restarts
- New `SESSIONS_FILE` env var to override the default path (empty string disables persistence)
- Graceful handling of corrupt, missing, or stale session files — logs a warning and starts fresh
- No adapter changes needed: persisted sessions are loaded into the Map at construction time, so `get()` finds them transparently

## 28. Improve web rendering of plan mode and implement action

- Mode changes now finalize the buffer (own message chunk) so they don't run into adjacent content
- "Entering plan mode" renders as a styled inline block (warm accent, like a tool header) in the web frontend
- "Starting implementation" renders as an interactive button ("Implement now") in the web frontend — clicking sends "Please start implementation" and disables the button
- Removed extra newlines from all renderers since the coordinator now handles separation via finalize

## 27. Add input_request and mode_change event abstractions

- New `InputRequestEvent` (`type: "input_request"`) for when the LLM asks the user a question — platform-agnostic, each plugin maps its SDK-specific tools to it
- New `ModeChangeEvent` (`type: "mode_change"`, mode `"plan"` | `"execute"`) for plan mode transitions
- Claude event mapper intercepts `AskUserQuestion` → `input_request`, `EnterPlanMode` → `mode_change(plan)`, `ExitPlanMode` → `mode_change(execute)` instead of emitting them as generic tool_use events
- All five renderers (Discord, Web, Telegram, WhatsApp) implement `renderInputRequest` and `renderModeChange`; web frontend renders questions with accent-colored left border and mode changes as italic annotations
- StreamCoordinator and logger handle the two new event types

## 26. Web adapter: survive page refresh (session + message history)

- Session ID now stored in `localStorage` instead of `sessionStorage`, so it persists across refresh and tab close
- Chat transcript saved to `localStorage` (capped at 200 entries) — restored into the DOM on page load
- Bot message text finalized from streaming updates on "done" event to avoid localStorage thrashing
- Server emits a "restored" system event on SSE connect when an active conversation exists, restoring the plugin label
- TTS toggle state also persisted in `localStorage`
