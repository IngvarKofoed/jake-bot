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

/** A single buffered SSE event with its monotonic sequence ID. */
export interface BufferedEvent {
  id: number;
  kind: "event" | "system";
  data: WebPlatformEvent | Record<string, unknown>;
}

export type EventListener = (data: WebPlatformEvent, id: number) => void;
export type SystemListener = (data: Record<string, unknown>, id: number) => void;

const DEFAULT_CAPACITY = 500;

/**
 * Per-session ring buffer that captures every emitted SSE event so that
 * reconnecting clients can replay missed events via Last-Event-ID.
 */
export class EventBuffer {
  private readonly emitter = new EventEmitter();
  private readonly ring: BufferedEvent[] = [];
  private seq = 0;

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  /** Append an event, store it in the ring, and emit to live listeners. */
  push(kind: "event", data: WebPlatformEvent): number;
  push(kind: "system", data: Record<string, unknown>): number;
  push(kind: "event" | "system", data: WebPlatformEvent | Record<string, unknown>): number {
    const id = ++this.seq;
    this.ring.push({ id, kind, data });
    while (this.ring.length > this.capacity) this.ring.shift();
    this.emitter.emit(kind, data, id);
    return id;
  }

  /** Return all buffered events with id strictly greater than afterId. */
  replay(afterId: number): BufferedEvent[] {
    const idx = this.ring.findIndex(e => e.id > afterId);
    return idx >= 0 ? this.ring.slice(idx) : [];
  }

  /** Current sequence number (0 if nothing buffered yet). */
  get currentSeq(): number {
    return this.seq;
  }

  onEvent(fn: EventListener): void { this.emitter.on("event", fn); }
  offEvent(fn: EventListener): void { this.emitter.off("event", fn); }
  onSystem(fn: SystemListener): void { this.emitter.on("system", fn); }
  offSystem(fn: SystemListener): void { this.emitter.off("system", fn); }
  removeAllListeners(): void { this.emitter.removeAllListeners(); }
}

/**
 * Web platform that bridges StreamCoordinator send/edit calls to
 * per-session EventBuffers consumed by SSE endpoints.
 *
 * Every event passes through an {@link EventBuffer} so that reconnecting
 * clients can replay missed events using the SSE `Last-Event-ID` mechanism.
 */
export class WebPlatform implements ChatPlatform {
  readonly name = "web";
  readonly constraints: PlatformConstraints = {
    charLimit: 100_000,
    supportsEdit: true,
    editRateLimitMs: 50,
    supportsThreads: false,
  };

  private readonly channels = new Map<string, EventBuffer>();

  private channel(channelId: string): EventBuffer {
    let buf = this.channels.get(channelId);
    if (!buf) {
      buf = new EventBuffer();
      this.channels.set(channelId, buf);
    }
    return buf;
  }

  /** Get or create the EventBuffer for a channel (used by SSE endpoint). */
  subscribe(channelId: string): EventBuffer {
    return this.channel(channelId);
  }

  /** Remove live listeners but keep the buffer for replay on reconnect. */
  detach(channelId: string): void {
    const buf = this.channels.get(channelId);
    if (buf) buf.removeAllListeners();
  }

  /** Fully remove a channel and its buffer. */
  destroyChannel(channelId: string): void {
    const buf = this.channels.get(channelId);
    if (buf) {
      buf.removeAllListeners();
      this.channels.delete(channelId);
    }
  }

  /** Push a system event into the channel buffer. */
  pushSystem(channelId: string, data: Record<string, unknown>): void {
    this.channel(channelId).push("system", data);
  }

  /** Push a platform event into the channel buffer. */
  pushEvent(channelId: string, ev: WebPlatformEvent): void {
    this.channel(channelId).push("event", ev);
  }

  async send(channelId: string, msg: OutboundMessage): Promise<MessageRef> {
    const messageId = randomUUID();
    const ev: WebPlatformEvent = { type: "message", messageId, text: msg.text };
    this.channel(channelId).push("event", ev);
    return { channelId, messageId };
  }

  async edit(ref: MessageRef, msg: OutboundMessage): Promise<void> {
    const ev: WebPlatformEvent = { type: "update", messageId: ref.messageId, text: msg.text };
    this.channel(ref.channelId).push("event", ev);
  }

  async sendTyping(channelId: string): Promise<void> {
    const ev: WebPlatformEvent = { type: "typing", active: true };
    this.channel(channelId).push("event", ev);
  }

  async stopTyping(channelId: string): Promise<void> {
    const ev: WebPlatformEvent = { type: "typing", active: false };
    this.channel(channelId).push("event", ev);
  }
}
