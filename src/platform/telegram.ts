import type { ChatPlatform, PlatformConstraints, MessageRef, OutboundMessage } from "./types.js";

/**
 * Telegram platform stub -- will use grammY or Telegraf.
 */
export class TelegramPlatform implements ChatPlatform {
  readonly name = "telegram";
  readonly constraints: PlatformConstraints = {
    charLimit: 4096,
    supportsEdit: true,
    editRateLimitMs: 1000,
    supportsThreads: false,
  };

  async send(_channelId: string, _msg: OutboundMessage): Promise<MessageRef> {
    throw new Error("TelegramPlatform not implemented");
  }

  async edit(_ref: MessageRef, _msg: OutboundMessage): Promise<void> {
    throw new Error("TelegramPlatform not implemented");
  }
}
