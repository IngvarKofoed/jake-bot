/**
 * Tracks active conversations per (userId, channelId) pair.
 * Each conversation is bound to a specific plugin and working directory.
 */

export interface Conversation {
  pluginId: string;
  workdir: string;
  sessionId?: string;
  startedAt: number;
}

type ConvoKey = string;

function makeKey(userId: string, channelId: string): ConvoKey {
  return `${userId}:${channelId}`;
}

export class ActiveConversations {
  private readonly convos = new Map<ConvoKey, Conversation>();

  start(
    userId: string,
    channelId: string,
    pluginId: string,
    workdir: string,
  ): Conversation {
    const key = makeKey(userId, channelId);
    const existing = this.convos.get(key);
    if (existing) {
      throw new Error(
        `Already in a ${existing.pluginId} conversation. Use /end first.`,
      );
    }
    const convo: Conversation = {
      pluginId,
      workdir,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    return convo;
  }

  get(userId: string, channelId: string): Conversation | undefined {
    return this.convos.get(makeKey(userId, channelId));
  }

  updateSessionId(userId: string, channelId: string, sessionId: string): void {
    const convo = this.convos.get(makeKey(userId, channelId));
    if (convo) convo.sessionId = sessionId;
  }

  end(userId: string, channelId: string): boolean {
    return this.convos.delete(makeKey(userId, channelId));
  }

  listAll(): Array<{ userId: string; channelId: string; conversation: Conversation }> {
    return [...this.convos.entries()].map(([key, conversation]) => {
      const [userId, channelId] = key.split(":");
      return { userId, channelId, conversation };
    });
  }

  /** Resume an ended conversation with a known sessionId. */
  resume(
    userId: string,
    channelId: string,
    pluginId: string,
    workdir: string,
    sessionId: string,
  ): Conversation {
    const key = makeKey(userId, channelId);
    const convo: Conversation = {
      pluginId,
      workdir,
      sessionId,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    return convo;
  }
}
