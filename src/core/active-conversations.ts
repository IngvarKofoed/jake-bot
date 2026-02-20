/**
 * Tracks active conversations per (userId, channelId) pair.
 * Each conversation is bound to a specific plugin and working directory.
 */

import { existsSync } from "node:fs";
import { log } from "./logger.js";

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
    if (!existsSync(workdir)) {
      throw new Error(`Working directory does not exist: ${workdir}`);
    }
    const convo: Conversation = {
      pluginId,
      workdir,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    log.info("convo", `start user=${userId} channel=${channelId} plugin=${pluginId} workdir=${workdir}`);
    return convo;
  }

  get(userId: string, channelId: string): Conversation | undefined {
    return this.convos.get(makeKey(userId, channelId));
  }

  updateSessionId(userId: string, channelId: string, sessionId: string): void {
    const convo = this.convos.get(makeKey(userId, channelId));
    if (convo) {
      convo.sessionId = sessionId;
      log.info("convo", `session user=${userId} channel=${channelId} sessionId=${sessionId}`);
    }
  }

  end(userId: string, channelId: string): boolean {
    const deleted = this.convos.delete(makeKey(userId, channelId));
    if (deleted) {
      log.info("convo", `end user=${userId} channel=${channelId}`);
    }
    return deleted;
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
    if (!existsSync(workdir)) {
      throw new Error(`Working directory does not exist: ${workdir}`);
    }
    const key = makeKey(userId, channelId);
    const convo: Conversation = {
      pluginId,
      workdir,
      sessionId,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    log.info("convo", `resume user=${userId} channel=${channelId} plugin=${pluginId} session=${sessionId}`);
    return convo;
  }
}
