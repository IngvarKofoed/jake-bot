/**
 * Tracks active conversations per (userId, channelId) pair.
 * Each conversation is bound to a specific plugin and working directory.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
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

function resolveWorkdir(workdir: string): string {
  return resolve(homedir(), workdir);
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
    const resolved = resolveWorkdir(workdir);
    if (!existsSync(resolved)) {
      throw new Error(`Working directory does not exist: ${resolved}`);
    }
    const convo: Conversation = {
      pluginId,
      workdir: resolved,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    log.info("convo", `start user=${userId} channel=${channelId} plugin=${pluginId} workdir=${resolved}`);
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
    const resolved = resolveWorkdir(workdir);
    if (!existsSync(resolved)) {
      throw new Error(`Working directory does not exist: ${resolved}`);
    }
    const key = makeKey(userId, channelId);
    const convo: Conversation = {
      pluginId,
      workdir: resolved,
      sessionId,
      startedAt: Date.now(),
    };
    this.convos.set(key, convo);
    log.info("convo", `resume user=${userId} channel=${channelId} plugin=${pluginId} session=${sessionId}`);
    return convo;
  }
}
