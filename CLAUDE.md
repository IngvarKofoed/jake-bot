# jake-bot

Multi-model Discord bot (Claude, Gemini, Codex). TypeScript, ESM, Node.js.

## Docs

- `docs/ARCHITECTURE.md` — full design doc with code examples
- `docs/ARCHITECTURE_BRIEF.md` — project structure, patterns, data flow

## Commands

- `npm run dev` — start bot with tsx
- `npm run build` — compile TypeScript
- `npm start` — run compiled output
- `npm run process-manager` — standalone process manager daemon

## Conventions

- ESM throughout (`"type": "module"`, `.js` extensions in imports)
- Strict TypeScript — no `any`, no implicit returns
- Discriminated unions over class hierarchies for data types
- Async generators for streaming — no queue bridges
- Platform-agnostic core: never import discord.js outside `src/platform/discord.ts` and `src/adapters/discord.ts`
- All logging goes through `src/core/logger.ts` — never use raw `console.log/warn/error`
- No formatting in core/stream layer — all text formatting lives in `src/rendering/` renderers

## Changelog

After each task, append a summary to `docs/CHANGELOG.md`. Each entry is numbered sequentially (higher than the previous). Use a **compact format**: describe what changed in 1-5 bullet points.

## Environment

Requires `.env` with `DISCORD_TOKEN` and `DISCORD_APP_ID`. See `.env.example`.


