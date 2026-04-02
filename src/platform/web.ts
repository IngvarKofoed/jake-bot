import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ChatPlatform, MessageRef, OutboundMessage, PlatformConstraints } from "./types.js";

export interface WebPlatformEvent {
  type: "message" | "update" | "typing" | "done" | "audio" | "audio_done";
  messageId?: string;
  text?: string;
  active?: boolean;
  /** Base64-encoded MP3 audio data (for type "audio"). */
  audio?: string;
  /** Chunk index, 0-based (for type "audio"). */
  index?: number;
  /** Total number of audio chunks (for type "audio"). */
  total?: number;
}

/**
 * Web platform that bridges StreamCoordinator send/edit calls to
 * per-session EventEmitters consumed by SSE endpoints.
 */
export class WebPlatform implements ChatPlatform {
  readonly name = "web";
  readonly constraints: PlatformConstraints = {
    charLimit: 100_000,
    supportsEdit: true,
    editRateLimitMs: 50,
    supportsThreads: false,
  };

  private readonly channels = new Map<string, EventEmitter>();

  private emitter(channelId: string): EventEmitter {
    let em = this.channels.get(channelId);
    if (!em) {
      em = new EventEmitter();
      this.channels.set(channelId, em);
    }
    return em;
  }

  /** Subscribe to events for a channel (used by SSE endpoint). */
  subscribe(channelId: string): EventEmitter {
    return this.emitter(channelId);
  }

  /** Remove a channel's emitter when the SSE connection closes. */
  unsubscribe(channelId: string): void {
    const em = this.channels.get(channelId);
    if (em) {
      em.removeAllListeners();
      this.channels.delete(channelId);
    }
  }

  async send(channelId: string, msg: OutboundMessage): Promise<MessageRef> {
    const messageId = randomUUID();
    const ev: WebPlatformEvent = { type: "message", messageId, text: msg.text };
    this.emitter(channelId).emit("event", ev);
    return { channelId, messageId };
  }

  async edit(ref: MessageRef, msg: OutboundMessage): Promise<void> {
    const ev: WebPlatformEvent = { type: "update", messageId: ref.messageId, text: msg.text };
    this.emitter(ref.channelId).emit("event", ev);
  }

  async sendTyping(channelId: string): Promise<void> {
    const ev: WebPlatformEvent = { type: "typing", active: true };
    this.emitter(channelId).emit("event", ev);
  }

  async stopTyping(channelId: string): Promise<void> {
    const ev: WebPlatformEvent = { type: "typing", active: false };
    this.emitter(channelId).emit("event", ev);
  }
}
