export interface PlatformConstraints {
  /** Max characters per message. */
  charLimit: number;
  /** Can we edit a sent message? */
  supportsEdit: boolean;
  /** Minimum ms between consecutive edits to the same message. */
  editRateLimitMs: number;
  /** Can we create threads / replies? */
  supportsThreads: boolean;
}

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface OutboundMessage {
  text: string;
  parseMode?: "markdown" | "html" | "plain";
}

export interface ChatPlatform {
  readonly name: string;
  readonly constraints: PlatformConstraints;

  send(channelId: string, msg: OutboundMessage): Promise<MessageRef>;
  edit(ref: MessageRef, msg: OutboundMessage): Promise<void>;
  delete?(ref: MessageRef): Promise<void>;
  sendTyping?(channelId: string): Promise<void>;
  stopTyping?(channelId: string): Promise<void>;
}
