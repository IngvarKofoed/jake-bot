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

## 26. Web adapter: survive page refresh (session + message history)

- Session ID now stored in `localStorage` instead of `sessionStorage`, so it persists across refresh and tab close
- Chat transcript saved to `localStorage` (capped at 200 entries) — restored into the DOM on page load
- Bot message text finalized from streaming updates on "done" event to avoid localStorage thrashing
- Server emits a "restored" system event on SSE connect when an active conversation exists, restoring the plugin label
- TTS toggle state also persisted in `localStorage`

## 27. Add input_request and mode_change event abstractions

- New `InputRequestEvent` (`type: "input_request"`) for when the LLM asks the user a question — platform-agnostic, each plugin maps its SDK-specific tools to it
- New `ModeChangeEvent` (`type: "mode_change"`, mode `"plan"` | `"execute"`) for plan mode transitions
- Claude event mapper intercepts `AskUserQuestion` → `input_request`, `EnterPlanMode` → `mode_change(plan)`, `ExitPlanMode` → `mode_change(execute)` instead of emitting them as generic tool_use events
- All five renderers (Discord, Web, Telegram, WhatsApp) implement `renderInputRequest` and `renderModeChange`; web frontend renders questions with accent-colored left border and mode changes as italic annotations
- StreamCoordinator and logger handle the two new event types

## 28. Structured options for input requests

- `InputRequestEvent` now carries an `options` array (`{ label, description? }`) alongside `text`
- Claude mapper extracts structured questions from `AskUserQuestion` tool (header, question, 2-4 options with label+description, multiSelect)
- `ExitPlanMode` emits `input_request(plan_approval)` with a single "Implement now" option
- All renderers receive and display options: Discord uses blockquotes, Telegram uses bold, WhatsApp uses bold
- Web frontend renders options as clickable buttons inside a styled card; clicking sends the option label as a message, disables all sibling buttons, and highlights the selection
- Option descriptions shown as tooltips on hover in the web frontend
- Mode changes finalize the buffer so they don't run into adjacent content

## 29. Fix orphaned "Working..." bubble for slash commands in web adapter

- Slash/voice commands (e.g. `/claude`, `/end`, `/status`) no longer leave a `div.msg.bot` "Working..." placeholder in the transcript
- Added `discardPendingResponse()` helper that removes the placeholder bubble if no real content arrived
- Called at the top of the SSE system event handler so any command-only response cleans up automatically

## 30. Styled command pills + status line in web adapter

- Slash commands (`/claude`, `/end`, `/status`, `/clear`) now render as small muted pill-shaped bubbles instead of full user chat bubbles
- Added persistent status line in topbar showing active plugin + shortened workdir (e.g. `Claude Code ~/data/jake-bot`)
- Commands no longer create a "Working..." bot placeholder; system messages suppressed for explicit commands (kept for auto-start and errors)
- New `"command"` history role persists and restores correctly from localStorage
- Backend system SSE events (`started`, `restored`, `clear`) now include `workdir` field

## 31. Active plugin-aware /clear (context reset)

- Added optional `clear?(sessionId, workdir)` method to `CliPlugin` interface — plugins actively participate in session reset
- Implemented `clear()` in Claude, Gemini, and Codex plugins (log + hook for future cleanup)
- `/clear` handler now calls `plugin.clear()` before resetting conversation state, instead of passively dropping the sessionId
- Updated reply message to "Context reset. Fresh {plugin} conversation in {workdir}." (matches Claude Code's mental model)
- Updated command description to "Reset context — starts a fresh session (same plugin & workdir)"

## 32. Fix /clear not clearing web UI transcript

- Backend sends `cleared: true` flag on the "started" system event emitted by `/clear`
- Frontend handles the flag by calling `clearHistory()` (wipes localStorage) and clearing the transcript DOM
- Shows a "Context cleared. Fresh {plugin} conversation." system message after clearing

## 33. Cap web UI width on large screens

- Added `max-width: 900px` with `margin: 0 auto` to `body` so the layout centers and doesn't stretch edge-to-edge on wide monitors
- Added subtle side borders (`#1e1e1e`) and a slightly lighter outer background (`#111111` on `html`) so the chat area feels inset

## 34. Fix numbered lists all showing "1." in web adapter

- `renderBotHtml()` list collection loop stopped at blank lines between items, creating separate `<ol>` per item (each starting at 1)
- Now skips blank lines when the next non-blank line is another list item, keeping the entire list in a single `<ol>`/`<ul>`

## 35. Disable controls when disconnected and send button when empty

- Send button starts disabled; enabled only when input has text and SSE is connected
- Input field, send button, and mic button all disabled when SSE connection is lost
- Keyboard shortcut (Space for mic) also guarded by connected state
- `send()` rejects calls when disconnected

## 36. /end command clears conversation in web adapter

- `/end` now clears transcript and localStorage history before showing "Conversation ended."

## 37. Dynamic browser tab title in web adapter

- Title shows `Thinking...` while the bot is working, `Jake` when idle
- Unread counter `(3)` prefixed when responses arrive while the tab is backgrounded; resets on focus

## 38. Auto-focus input field on page load in web adapter

- Focus the text input after SSE connection opens so the user can type immediately after refresh

## 39. Fix duplicate input-request divs in web adapter

- `extractQuestions` → `extractAllQuestions`: handle all questions in `AskUserQuestion`, not just the first
- `mapSpecialTool` now returns an array of events (one per question)
- Deduplicate `responseOrder` to prevent repeated message IDs from duplicating rendered content
- Clicking any option button now disables ALL option buttons in the bot bubble, not just the same question's

## 40. Filtered command suggestions and @file references

- New `src/core/command-registry.ts`: platform-agnostic command registry with `match(query)` prefix filtering; `registerStandardCommands()` defines the 6 shared commands
- New `src/core/file-listing.ts`: single-level directory listing with ignore patterns (`.git`, `node_modules`, etc.) and path traversal guard
- New `src/core/file-references.ts`: parses `@path` tokens from messages and expands them inline as `<file>` XML tags before routing to plugins — no `ExecuteInput`/`Router`/plugin changes needed
- Web adapter: new `GET /api/completions` endpoint for slash-command and file completions; `@file` expansion in `processMessage()` before `router.route()`
- Web frontend: autocomplete dropdown above input field triggered by `/` (commands) or `@` (files); keyboard navigation (arrows, Enter/Tab, Escape), click selection, directory drill-down, debounced file fetches
- Discord adapter: `buildSlashCommandsJSON()` now derives shared commands from the registry (DRY), keeping Discord-only commands (`/conversations`, `/resume`) local

## 41. Fix double-slash in web autocomplete command icon

- Removed gray `/` icon from slash-command autocomplete items — label already contains the `/` prefix
- Tightened autocomplete item padding and skip rendering the empty icon span so commands sit closer to the box edge

## 42. Fun placeholder text in web adapter

- Changed the "Working..." placeholder bubble to "Cooking up something good…" for a more energizing vibe

## 43. Reject dangerous workdir paths (homedir, root, system dirs)

- Added `validateWorkdir()` in `ActiveConversations` that blocks home directory, `/`, and system paths (`/etc`, `/usr`, `/var`, `/tmp`, `/opt`, `/bin`, `/sbin`)
- Applied to both `start()` and `resume()` — covers all adapters (Discord, Web) uniformly
- Previously, `/claude` with no `workdir` silently defaulted to `homedir()`, giving the AI access to the entire home directory

## 44. Fix double error message and session loss on bad arguments

- Web adapter's `startConversation` called `conversations.end()` before `start()` — if `start()` threw (e.g. bad workdir), the existing session was already gone
- Added `ActiveConversations.replace()` that validates the new workdir before any mutation, so a bad path never kills an active session
- Errors were shown twice: once via SSE system event, once from the HTTP 500 response. Now always returns HTTP 200 with errors delivered only through the SSE channel
- Wrapped StreamCoordinator's event loop in try-catch so a plugin generator that throws (instead of yielding `fatal_error`) is rendered inline rather than bubbling up to the adapter for a duplicate error

## 45. Fix 6 architecture bugs found by 3-model code review

- **StreamCoordinator split corruption:** Recalculate `renderStart` offsets for all open blocks after `split()` so streaming text isn't garbled when responses exceed the platform char limit; also fix latent `stopTyping?.().catch()` TypeError for platforms without `stopTyping`
- **Discord concurrency guard:** Added `busy` Set to `DiscordAdapter` — rejects follow-up messages while a route is in progress for the same (user, channel), preventing interleaved `send()`/`edit()` calls
- **Gemini orphaned processes:** Kill the spawned child process in the `finally` block of `GeminiPlugin.execute()` so early generator abort doesn't leak Gemini CLI processes
- **Block ID collisions:** Replaced module-level `blockSeq` counters in Claude and Codex event mappers with per-invocation factories (`createClaudeMapper`, `createCodexMapper`) — eliminates cross-invocation ID conflicts
- **Gemini MCP config race:** Added reference-counted `activeLeases` map so concurrent Gemini invocations sharing the same git root don't clobber each other's `.gemini/settings.json`; only the last finisher restores the original file
- **MCP server leak:** Process manager now creates a single `McpServer` instance at startup instead of one per POST request, preventing resource accumulation over long runtimes

## 46. Expose web adapter on local network

- Added `webHost` config option (`WEB_HOST` env var, defaults to `0.0.0.0`) so the HTTP server binds to all interfaces instead of localhost-only
- Updated `server.listen()` call, log message, and `.env.example`

## 47. Add DISCORD_ALLOWED_USER_IDS access control

- Parse `DISCORD_ALLOWED_USER_IDS` env var (comma/space-separated) into `ReadonlySet<string>` on `BotConfig`; empty = allow all users
- Guard `interactionCreate` with ephemeral rejection and `messageCreate` with silent ignore for unauthorized user IDs

## 48. Step-by-step wizard UI for multi-question input requests

- When `AskUserQuestion` sends multiple questions, the web adapter now renders a wizard with a step counter ("Step 1 / 3") instead of showing all questions at once
- Only the current step's buttons are clickable; answering advances to the next step, dimming the completed one
- After the last step, all answers are sent as a numbered list (e.g. `1. Espresso\n2. Tabs`)
- Single-question input requests unchanged; restored history buttons disabled on page refresh
- Input request buttons (single and wizard) always render at the bottom of the bot bubble, so accompanying text/descriptions appear above them
- Buttons hidden during streaming (`.streaming` CSS class) and revealed on `done`, preventing premature clicks that would be wiped by re-renders
- Frontend-only change in `web-page.ts` — no backend modifications

## 49. Document web adapter + fix silent @file expansion

- Added all web adapter files to `ARCHITECTURE_BRIEF.md`: adapters, platform, renderer, and core utilities (file-references, file-listing, command-registry, google-tts)
- Updated data flow diagram and environment variables table with web-specific entries
- Fixed `@file` references being invisibly expanded: the web adapter now emits an `"info"` system event listing successfully attached files so the user sees what the AI received
- Added `"info"` and `"warning"` handlers to the web page SSE listener; these fire mid-routing and no longer discard the pending response bubble

## 50. Fix process manager crash on second MCP connection

- `McpServer.connect()` throws if already connected to a transport — the shared instance crashed on any second request
- Now creates a fresh `McpServer` per POST to `/mcp`; the `ProcessSupervisor` (actual state) remains shared

## 51. Fix web adapter completely broken on iPhone (LAN access)

- **Root cause:** `crypto.randomUUID()` requires a secure context — works on `localhost` (desktop) but throws on `http://192.168.x.x` (iPhone over LAN), crashing the entire `<script>` before any event listeners are attached
- Added `generateUUID()` fallback using `Math.random` when `crypto.randomUUID` is unavailable
- Added explicit Enter keydown handler so form submission works even when the submit button is disabled (iOS Safari quirk)
- Added `keyup`/`change` event fallbacks and `autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="send"` on the input as defense-in-depth
- Bumped input font-size from 13px to 16px to prevent iOS Safari auto-zoom on focus

## 52. Add copy & TTS buttons to web message footer

- Added two flat-icon buttons (copy, speaker) to the duration footer of each bot message in the web UI
- Copy button uses Clipboard API (with `execCommand` fallback for non-HTTPS) and shows a brief green highlight
- TTS button reuses the existing `/api/tts` endpoint and audio playback pipeline
- Buttons render on restored history messages as well

## 53. SSE event replay on web adapter reconnect

- Added `EventBuffer` class to `WebPlatform` — per-session ring buffer (500 events) that stores every SSE event with a monotonic sequence ID
- All events (content, system, TTS audio) now flow through the buffer; every SSE frame includes an `id:` field for the native SSE `Last-Event-ID` mechanism
- On SSE reconnect (auto or page reload), server replays missed events from the buffer so in-flight responses survive tab close / network drops
- Client stores `lastEventId` in localStorage and passes it as a query param on page reload; `onopen` no longer eagerly clears response state
- Replaced the `"restored"` system event with a richer `"connected"` event carrying `replayed` count, `busy` flag, plugin name, and workdir

## 54. Fix SSE listeners killed by stale connection cleanup

- SSE close handler called `platform.detach()` which uses `removeAllListeners()` — this nukes listeners for ALL connections to the same channel, not just the closing one
- If EventSource auto-reconnected (new connection B) while the old TCP connection (A) was still draining, A's eventual close would kill B's listeners, silently dropping all subsequent events
- Root cause of "last message missing" in long web sessions: footer and `done` events were pushed to the ring buffer but never written to the live SSE response
- Fix: removed `detach()` call from close handler — `offEvent`/`offSystem` already remove the connection-specific listeners

## 55. Backend-driven lastText for copy & TTS buttons

- StreamCoordinator now tracks the content of the last completed text block (`lastTextContent`) and returns it as `StreamResult.lastText`
- `lastText` flows through Router → web adapter → SSE `done` event, so the frontend receives clean final text from the backend
- Frontend `speakLast()` and copy handler use `cleanTextMap` (WeakMap) populated from `done` event instead of fragile DOM text extraction
- Restored iOS autocapitalize and spellcheck on the input field
