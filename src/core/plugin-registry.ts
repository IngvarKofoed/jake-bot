import type { CliPlugin } from "../plugins/types.js";

export class PluginRegistry {
  private readonly plugins = new Map<string, CliPlugin>();

  register(plugin: CliPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin '${plugin.id}' already registered`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): CliPlugin | undefined {
    return this.plugins.get(id);
  }

  require(id: string): CliPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Unknown plugin: '${id}'`);
    return plugin;
  }

  list(): CliPlugin[] {
    return [...this.plugins.values()];
  }

  ids(): string[] {
    return [...this.plugins.keys()];
  }
}
