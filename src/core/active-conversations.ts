/**
 * Tracks active conversations per (userId, channelId) pair.
 * Each conversation is bound to a specific plugin and working directory.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
  private readonly persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  // -- Persistence -------------------------------------------------------

  /** Load persisted sessions from disk. Best-effort: logs warnings on failure. */
  private load(): void {
    if (!this.persistPath) return;

    let raw: string;
    try {
      raw = readFileSync(this.persistPath, "utf-8");
    } catch {
      // File doesn't exist yet — first run.
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      log.warn("convo", `Corrupt sessions file, starting fresh: ${this.persistPath}`);
      return;
    }

    if (typeof data !== "object" || data === null) {
      log.warn("convo", `Invalid sessions file format, starting fresh: ${this.persistPath}`);
      return;
    }

    let loaded = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(data)) {
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.pluginId !== "string" ||
        typeof entry.workdir !== "string" ||
        typeof entry.startedAt !== "number"
      ) {
        skipped++;
        continue;
      }
      if (!existsSync(entry.workdir as string)) {
        skipped++;
        continue;
      }
      const convo: Conversation = {
        pluginId: entry.pluginId as string,
        workdir: entry.workdir as string,
        startedAt: entry.startedAt as number,
      };
      if (typeof entry.sessionId === "string") convo.sessionId = entry.sessionId;
      this.convos.set(key, convo);
      loaded++;
    }

    log.info(
      "convo",
      `Loaded ${loaded} persisted session(s)${skipped > 0 ? ` (${skipped} skipped)` : ""} from ${this.persistPath}`,
    );
  }

  /** Persist the current conversation map to disk. */
  private save(): void {
    if (!this.persistPath) return;

    const data: Record<string, Conversation> = {};
    for (const [key, convo] of this.convos) {
      data[key] = convo;
    }

    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    } catch (err) {
      log.error("convo", `Failed to save sessions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -- Mutation methods ---------------------------------------------------

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
        `Already in a ${existing.pluginId} conversation. Use /end or /clear first.`,
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
    this.save();
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
      this.save();
      log.info("convo", `session user=${userId} channel=${channelId} sessionId=${sessionId}`);
    }
  }

  end(userId: string, channelId: string): boolean {
    const deleted = this.convos.delete(makeKey(userId, channelId));
    if (deleted) {
      this.save();
      log.info("convo", `end user=${userId} channel=${channelId}`);
    }
    return deleted;
  }

  /** End the current conversation and immediately start a fresh one with the same plugin/workdir. */
  clear(userId: string, channelId: string): Conversation | undefined {
    const key = makeKey(userId, channelId);
    const existing = this.convos.get(key);
    if (!existing) return undefined;
    const { pluginId, workdir } = existing;
    this.convos.delete(key);
    const convo: Conversation = { pluginId, workdir, startedAt: Date.now() };
    this.convos.set(key, convo);
    this.save();
    log.info("convo", `clear user=${userId} channel=${channelId} plugin=${pluginId}`);
    return convo;
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
    this.save();
    log.info("convo", `resume user=${userId} channel=${channelId} plugin=${pluginId} session=${sessionId}`);
    return convo;
  }
}
