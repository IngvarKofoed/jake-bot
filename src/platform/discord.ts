import { Client, TextChannel } from "discord.js";
import type { ChatPlatform, PlatformConstraints, MessageRef, OutboundMessage } from "./types.js";

export class DiscordPlatform implements ChatPlatform {
  readonly name = "discord";
  readonly constraints: PlatformConstraints = {
    charLimit: 1900,
    supportsEdit: true,
    editRateLimitMs: 500,
    supportsThreads: true,
  };

  constructor(private readonly client: Client) {}

  async send(channelId: string, msg: OutboundMessage): Promise<MessageRef> {
    const channel = (await this.client.channels.fetch(channelId)) as TextChannel;
    const sent = await channel.send(msg.text);
    return { channelId, messageId: sent.id };
  }

  async edit(ref: MessageRef, msg: OutboundMessage): Promise<void> {
    const channel = (await this.client.channels.fetch(ref.channelId)) as TextChannel;
    const message = await channel.messages.fetch(ref.messageId);
    await message.edit(msg.text);
  }

  async sendTyping(channelId: string): Promise<void> {
    const channel = (await this.client.channels.fetch(channelId)) as TextChannel;
    await channel.sendTyping();
  }
}
