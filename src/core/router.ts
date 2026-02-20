import type { PluginContext } from "../plugins/types.js";
import type { ChatPlatform } from "../platform/types.js";
import type { Renderer } from "../rendering/types.js";
import type { CompleteEvent, FatalErrorEvent } from "../stream/events.js";
import { StreamCoordinator } from "../stream/stream-coordinator.js";
import { ActiveConversations } from "./active-conversations.js";
import { PluginRegistry } from "./plugin-registry.js";

export interface RouteResult {
  event?: CompleteEvent | FatalErrorEvent;
  sessionId?: string;
}

export class Router {
  private readonly coordinator: StreamCoordinator;

  constructor(
    private readonly plugins: PluginRegistry,
    private readonly conversations: ActiveConversations,
    private readonly platform: ChatPlatform,
    renderer: Renderer,
    private readonly ctx: PluginContext,
  ) {
    this.coordinator = new StreamCoordinator(platform, renderer);
  }

  /**
   * Route a user message through the active conversation's plugin
   * and stream the response to the channel.
   */
  async route(
    userId: string,
    channelId: string,
    message: string,
  ): Promise<RouteResult> {
    const convo = this.conversations.get(userId, channelId);
    if (!convo) {
      await this.platform.send(channelId, {
        text: "No active conversation. Start one with `/claude`, `/gemini`, or `/codex`.",
        parseMode: "markdown",
      });
      return {};
    }

    const plugin = this.plugins.require(convo.pluginId);
    const events = plugin.execute(
      {
        workdir: convo.workdir,
        message,
        sessionId: convo.sessionId,
      },
      this.ctx,
    );

    const result = await this.coordinator.run(channelId, events);

    // Capture session ID from the complete event for future turns
    if (result?.type === "complete" && result.sessionId) {
      this.conversations.updateSessionId(userId, channelId, result.sessionId);
    }

    return {
      event: result,
      sessionId: result?.type === "complete" ? result.sessionId : undefined,
    };
  }
}
