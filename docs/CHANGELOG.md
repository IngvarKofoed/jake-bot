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
