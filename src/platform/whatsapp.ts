import type { ChatPlatform, PlatformConstraints, MessageRef, OutboundMessage } from "./types.js";

/**
 * WhatsApp platform stub -- will use Baileys.
 */
export class WhatsAppPlatform implements ChatPlatform {
  readonly name = "whatsapp";
  readonly constraints: PlatformConstraints = {
    charLimit: 65536,
    supportsEdit: false,
    editRateLimitMs: 0,
    supportsThreads: false,
  };

  async send(_channelId: string, _msg: OutboundMessage): Promise<MessageRef> {
    throw new Error("WhatsAppPlatform not implemented");
  }

  async edit(_ref: MessageRef, _msg: OutboundMessage): Promise<void> {
    throw new Error("WhatsAppPlatform does not support editing");
  }
}
