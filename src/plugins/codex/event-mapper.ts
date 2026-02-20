import type { BotEvent } from "../../stream/events.js";

/**
 * Codex SDK event type (hypothetical -- adapt when SDK is available).
 */
export interface CodexSdkEvent {
  type: string;
  [key: string]: unknown;
}

let blockSeq = 0;
const nextId = () => `codex_b${blockSeq++}`;

/**
 * Map a Codex SDK event to a BotEvent.
 * Stub implementation -- will be fleshed out when the Codex SDK
 * stabilizes its event model.
 */
export function mapCodexEvent(sdkEvent: CodexSdkEvent): BotEvent {
  const ts = Date.now();

  switch (sdkEvent.type) {
    case "text":
      return {
        type: "block_emit",
        pluginId: "codex",
        ts,
        block: {
          id: nextId(),
          kind: "system",
          subtype: "notice",
          message: (sdkEvent.text as string) ?? "",
        },
      };
    case "result":
      return {
        type: "complete",
        pluginId: "codex",
        ts,
        sessionId: sdkEvent.session_id as string | undefined,
      };
    default:
      return {
        type: "block_emit",
        pluginId: "codex",
        ts,
        block: {
          id: nextId(),
          kind: "system",
          subtype: "notice",
          message: `[codex] ${sdkEvent.type}: ${JSON.stringify(sdkEvent)}`,
        },
      };
  }
}
