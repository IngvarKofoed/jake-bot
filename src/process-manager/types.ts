import type { ChildProcess } from "node:child_process";

export type ProcessStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface ManagedProcess {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  pipeOutput?: boolean;
  status: ProcessStatus;
  pid?: number;
  exitCode?: number | null;
  startedAt: number;
  stoppedAt?: number;
  stdout: RingBuffer;
  stderr: RingBuffer;
  /** @internal */
  child?: ChildProcess;
}

export class RingBuffer {
  private chunks: string[] = [];
  private chars = 0;
  private _seq = 0;

  constructor(public readonly maxChars = 100_000) {}

  append(data: string): void {
    if (!data) return;
    this.chunks.push(data);
    this.chars += data.length;
    this._seq += 1;
    while (this.chars > this.maxChars && this.chunks.length > 0) {
      const evicted = this.chunks.shift()!;
      this.chars -= evicted.length;
    }
  }

  get seq(): number {
    return this._seq;
  }

  tail(n = 2000): string {
    let remaining = n;
    const out: string[] = [];
    for (let i = this.chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const c = this.chunks[i];
      if (c.length <= remaining) {
        out.push(c);
        remaining -= c.length;
      } else {
        out.push(c.slice(c.length - remaining));
        remaining = 0;
      }
    }
    return out.reverse().join("");
  }
}
