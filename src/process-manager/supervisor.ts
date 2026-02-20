import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { RingBuffer, type ManagedProcess } from "./types.js";

export class ProcessSupervisor {
  private readonly processes = new Map<string, ManagedProcess>();

  async start(input: {
    name: string;
    command: string;
    args?: string[];
    cwd: string;
    env?: Record<string, string>;
    pipeOutput?: boolean;
  }): Promise<ManagedProcess> {
    const existing = this.processes.get(input.name);
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      return existing;
    }

    const managed: ManagedProcess = {
      name: input.name,
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd,
      env: input.env,
      pipeOutput: input.pipeOutput ?? existing?.pipeOutput,
      status: "starting",
      startedAt: Date.now(),
      stdout: new RingBuffer(),
      stderr: new RingBuffer(),
    };
    this.processes.set(input.name, managed);

    const child = spawn(input.command, managed.args, {
      cwd: managed.cwd,
      env: { ...process.env, ...managed.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    managed.child = child;
    managed.pid = child.pid;
    managed.status = "running";

    child.stdout.on("data", (buf: Buffer) => {
      const str = buf.toString();
      managed.stdout.append(str);
      if (managed.pipeOutput) process.stdout.write(buf);
    });
    child.stderr.on("data", (buf: Buffer) => {
      const str = buf.toString();
      managed.stderr.append(str);
      if (managed.pipeOutput) process.stderr.write(buf);
    });
    child.on("exit", (code) => {
      managed.exitCode = code;
      managed.stoppedAt = Date.now();
      if (managed.status !== "stopping") {
        managed.status = code === 0 ? "stopped" : "failed";
      }
    });

    return managed;
  }

  async stop(name: string, force = false): Promise<ManagedProcess> {
    const p = this.processes.get(name);
    if (!p) throw new Error(`No process named '${name}'`);
    if (!p.child || p.status === "stopped" || p.status === "failed") return p;

    p.status = "stopping";
    const pid = p.child.pid!;

    if (process.platform === "win32") {
      const treeKill = (await import("tree-kill")).default;
      await new Promise<void>((resolve) =>
        treeKill(pid, force ? "SIGKILL" : "SIGTERM", () => resolve()),
      );
    } else {
      const sig = force ? "SIGKILL" : "SIGTERM";
      try {
        process.kill(-pid, sig);
      } catch {
        /* already dead */
      }

      if (!force) {
        await sleep(10_000);
        if (!p.child.killed) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* already dead */
          }
        }
      }
    }

    p.status = "stopped";
    return p;
  }

  list(): ManagedProcess[] {
    return [...this.processes.values()];
  }

  getOutput(name: string, tail = 2000) {
    const p = this.processes.get(name);
    if (!p) throw new Error(`No process named '${name}'`);
    return {
      name: p.name,
      status: p.status,
      pid: p.pid,
      stdout: p.stdout.tail(tail),
      stderr: p.stderr.tail(tail),
      stdoutSeq: p.stdout.seq,
      stderrSeq: p.stderr.seq,
    };
  }

  async stopAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.allSettled(names.map((n) => this.stop(n)));
  }
}
