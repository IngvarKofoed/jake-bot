/**
 * Platform-agnostic command registry.
 *
 * Holds canonical definitions of bot commands so every adapter can derive
 * its own command surface from the same source of truth.
 */

export interface CommandOption {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options: readonly CommandOption[];
  /** Grouping hint for UIs that show categories. */
  readonly category: "start" | "session" | "info";
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(cmd: CommandDefinition): void {
    if (this.commands.has(cmd.name)) {
      throw new Error(`Command '${cmd.name}' already registered`);
    }
    this.commands.set(cmd.name, cmd);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /** All registered commands. */
  all(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  /**
   * Filter commands whose name starts with `query` (case-insensitive).
   * Empty query returns all commands.
   */
  match(query: string): readonly CommandDefinition[] {
    const q = query.toLowerCase();
    if (!q) return this.all();
    return this.all().filter((cmd) => cmd.name.startsWith(q));
  }
}

/**
 * Register the standard bot commands shared across all adapters.
 *
 * Adapter-only commands (e.g. Discord's /conversations, /resume) are NOT
 * included here — adapters add those themselves.
 */
export function registerStandardCommands(registry: CommandRegistry): void {
  registry.register({
    name: "claude",
    description: "Start a Claude Code conversation",
    options: [{ name: "workdir", description: "Working directory", required: false }],
    category: "start",
  });
  registry.register({
    name: "gemini",
    description: "Start a Gemini conversation",
    options: [{ name: "workdir", description: "Working directory", required: false }],
    category: "start",
  });
  registry.register({
    name: "codex",
    description: "Start a Codex conversation",
    options: [{ name: "workdir", description: "Working directory", required: false }],
    category: "start",
  });
  registry.register({
    name: "end",
    description: "End the current conversation",
    options: [],
    category: "session",
  });
  registry.register({
    name: "clear",
    description: "Reset context — starts a fresh session (same plugin & workdir)",
    options: [],
    category: "session",
  });
  registry.register({
    name: "status",
    description: "Show current conversation status",
    options: [],
    category: "info",
  });
}
