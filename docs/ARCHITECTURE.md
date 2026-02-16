# jake-bot Architecture

> Three-model synthesis (Claude, Gemini, Codex) — February 2026

## High-Level Diagram

```
┌─────────────────────────────────────────────────────┐
│                  Chat Frontends                     │
│   DiscordAdapter  │  SlackAdapter  │  WebAdapter    │
└────────┬──────────┴───────┬────────┴───────┬────────┘
         │                  │                │
         ▼                  ▼                ▼
┌─────────────────────────────────────────────────────┐
│              Platform-Agnostic Core                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ Router       │ │Active Convos │ │Stream Coord. │ │
│  │ Formatter    │ │Plugin Reg.   │ │              │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                  CLI Plugin Layer                   │
│  ClaudeCodePlugin │ GeminiPlugin │ CodexPlugin │ …  │
└────────┬──────────┴──────┬───────┴──────┬───────────┘
         │                 │              │
         ▼                 ▼              ▼
┌─────────────────────────────────────────────────────┐
│     Short-lived CLI Processes (spawn per turn)     │
└─────────────────────────────────────────────────────┘
```

The bot is a **thin router** between a chat platform and short-lived CLI invocations. Conversation state lives entirely in the CLI (on disk, managed by the CLI itself). The bot only tracks which plugin and resume token to use for the next turn.

## Core Concepts

- **Plugin** — An adapter that knows how to invoke a specific CLI, pass it a message with a resume token, and parse its streamed output.
- **Active Conversation** — A lightweight mapping: `(user, channel) → {plugin, workdir, resume_token}`. No process is running between turns — just enough info to invoke the next one.
- **Resume Token** — A CLI-specific identifier (session ID, conversation ID, etc.) that the plugin passes to the CLI so it continues the same conversation. Returned by the CLI after each turn.
- **PluginEvent** — Unified event model for streaming output from any CLI back through the bot.
- **ResponseBlock** — Normalized content block (text, code, diff, etc.) that the formatter renders per-platform.

## How It Works

### Starting a Conversation

```
User: /claude start [workdir]
  → PluginRegistry looks up the Claude plugin
  → Core stores active conversation: (user, channel) → {plugin=claude, workdir, resume_token=None}
  → Bot replies: "Claude Code conversation started in /path/to/project. Just type to chat."
```

### Chatting (plain text — no commands needed)

```
User: "refactor the auth module to use JWT"
  → Router sees active conversation for this user/channel
  → Plugin spawns a CLI process: claude --session-id <resume_token> --print "refactor..."
  → CLI streams JSON output → plugin yields PluginEvents
  → StreamCoordinator throttles and buffers chunks
  → Formatter renders ResponseBlocks for Discord
  → Bot edits its reply message progressively as output streams in
  → CLI process exits → plugin extracts new resume_token from output
  → Core updates stored resume_token

User: "now add tests for it"
  → Same flow — CLI resumes the conversation using the stored resume_token
```

### Ending a Conversation

```
User: /conversation end
  → Core removes the active conversation mapping
  → Bot replies: "Conversation ended."
  → (The CLI's conversation history remains on disk — can be resumed later)
```

### Resuming a Previous Conversation

```
User: /claude conversations
  → Plugin invokes CLI to list past conversations (e.g., claude --list-conversations)
  → Bot shows a list with IDs, timestamps, summaries

User: /claude resume <conversation_id>
  → Core stores active conversation with the given ID as resume_token
  → Bot replies: "Resumed conversation <id>. Just type to chat."
```

This also handles bot reboots — active conversation mappings are lost (they're in-memory), but the CLI's conversation history is still on disk. The user just does `/claude resume` to pick up where they left off.

## Plugin Interface

```python
class CliPlugin(ABC):
    plugin_id: str
    display_name: str

    async def execute(
        workdir: str,
        message: str,
        resume_token: str | None = None,
    ) -> AsyncIterator[PluginEvent]
    # The COMPLETE event includes the new resume_token for the next turn.

    async def list_conversations(workdir: str) -> list[ConversationInfo]
    # Ask the CLI for its stored conversations.

    def parse_output(raw: str) -> list[ResponseBlock]
    def command_specs() -> list[CommandSpec]
```

```python
@dataclass
class ConversationInfo:
    """Summary of a past conversation, as reported by the CLI."""
    id: str              # CLI-specific conversation/session ID
    title: str | None    # summary or first message, if available
    timestamp: str | None
    plugin_id: str
```

Each plugin is a self-contained package. Adding a new CLI = adding one plugin, zero core changes. The plugin knows:
- How to invoke the CLI with the right flags for resume, streaming, output format
- How to parse the streamed output into `ResponseBlock`s
- How to extract the resume token from the CLI's output
- How to ask the CLI for past conversations
- How to normalize tool names into clean, human-readable display names (e.g. `mcp__process-manager__restart_process` → `Process Manager · Restart Process`). The formatter is CLI-agnostic — it renders whatever name the plugin provides, so each plugin must clean its own CLI's naming conventions.

## Platform Abstraction

```python
class ChatPlatformAdapter(ABC):
    async def register_commands(system_specs, plugin_specs)
    async def send_message(target, content)
    async def edit_message(ref, content)
```

Discord is just one implementation. The core never imports `discord`. Future frontends (Slack, Telegram, web UI) implement the same interface.

## Core Components

- **Router** — Checks if the user/channel has an active conversation. If yes, pipes plain text to the plugin via `execute()`. If no, only responds to slash commands.
- **ActiveConversations** — In-memory dict: `(user_id, channel_id) → {plugin_id, workdir, resume_token}`. Updated after each turn with the new resume token. Lost on reboot (by design — user can resume via `/claude resume`).
- **PluginRegistry** — Discovers and loads plugins. Exposes lookup by plugin ID.
- **StreamCoordinator** — Buffers `PluginEvent` chunks, throttles message edits (~2/sec to stay within Discord rate limits), splits long output across multiple messages.
- **Formatter** — Renders `ResponseBlock`s into platform-specific output (Discord embeds, code blocks, file attachments).

## PluginEvent Model

```python
class PluginEventType(Enum):
    TEXT_DELTA   # incremental text chunk
    STATUS       # status update (thinking, running tool, etc.)
    ERROR        # error with structured reason
    COMPLETE     # turn finished, includes final ResponseBlocks + new resume_token
```

## Response Normalization

Each CLI returns different output formats. The plugin's `parse_output()` transforms CLI-specific output into normalized `ResponseBlock`s before the core sees it.

```python
@dataclass
class ResponseBlock:
    type: ResponseBlockType
    content: str
    metadata: dict | None = None

class ResponseBlockType(Enum):
    TEXT       # plain text / markdown
    CODE       # code with language hint (metadata: {language, filename})
    DIFF       # file diff (metadata: {filepath, action})
    ERROR      # error message
    TOOL_USE   # tool invocation summary (metadata: {tool_name, status})
    JSON_RAW   # raw JSON the plugin chose not to transform
```

### Platform Rendering

| Block Type | Discord Rendering |
|---|---|
| `TEXT` | Plain message text (markdown) |
| `CODE` | Fenced code block with language hint |
| `DIFF` | Fenced `diff` code block |
| `ERROR` | Red embed or prefixed message |
| `TOOL_USE` | Compact embed with tool name + status |
| `JSON_RAW` | Code block, embed, or file upload depending on size |

## Command Structure

### System commands (core)

- `/claude start [workdir]` — start a new Claude Code conversation
- `/gemini start [workdir]` — start a new Gemini conversation
- `/codex start [workdir]` — start a new Codex conversation
- `/conversation end` — clear the active conversation (CLI history stays on disk)
- `/status` — show active conversation info
- `/workdir set <path>` — change working directory

### Conversation history (delegated to plugin)

- `/claude conversations` — list past conversations from the CLI
- `/claude resume <id>` — resume a previous conversation
- `/gemini conversations` / `/gemini resume <id>` — same for Gemini
- `/codex conversations` / `/codex resume <id>` — same for Codex

### Plugin commands (plugin-provided)

- `/claude model <name>` — plugin-specific config
- Other settings per plugin

No `/ask` commands — once started, just type.

## Project Structure

```
jake-bot/
  src/jake_bot/
    app.py                    # entry point
    config.py                 # env/config loading
    core/
      router.py               # message routing
      active_conversations.py # (user, channel) → {plugin, workdir, resume_token}
      plugin_registry.py      # plugin discovery
      stream_coordinator.py   # buffering, throttling
      formatter.py            # ResponseBlock → platform output
    models/
      events.py               # PluginEvent, PluginEventType
      blocks.py               # ResponseBlock, ResponseBlockType
      conversations.py        # ConversationInfo
    platforms/
      base.py                 # ChatPlatformAdapter ABC
      discord/
        adapter.py
        renderers.py
    plugins/
      base.py                 # CliPlugin ABC
      claude_code/
        plugin.py
        parser.py
      gemini_cli/
        plugin.py
        parser.py
      codex_cli/
        plugin.py
        parser.py
  tests/
  docs/
  requirements.txt
  .env
```

## Design Patterns

- **Ports & Adapters** — core isolated from both Discord and CLIs
- **Strategy** — each plugin is a strategy for talking to a specific CLI
- **Registry** — plugin discovery and lookup
- **Async iterator** — streaming events from plugins to the stream coordinator

## Trade-offs and Risks

| Concern | Mitigation |
|---|---|
| CLI output formats can change and break parsers | Version-pin CLIs, defensive parsing |
| Streaming edits hit Discord rate limits | Throttle to ~2 edits/second per message |
| Workdir = arbitrary filesystem access | Allowlisted root paths, path traversal protection |
| Active conversations lost on bot reboot | By design — CLI history persists on disk, user resumes with `/claude resume` |
| CLI doesn't support listing conversations | Plugin returns empty list; `list_conversations` is best-effort |
| Subprocess spawned per turn adds latency | Acceptable for AI CLI tools (response generation dominates); could cache/warm if needed |
