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
