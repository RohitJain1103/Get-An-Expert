import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PermissionGate } from "./permissions";
import type { ActivityEntry } from "./types";
import type { RawChannel } from "./webrtc/channel";

/** A live pseudo-terminal (the subset of node-pty's IPty we use). */
export interface IPtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SpawnOptions {
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
}

export type PtySpawner = (opts: SpawnOptions) => IPtyLike;

export interface PtyBridgeOptions {
  gate: PermissionGate;
  projectDir: string;
  onActivity: (entry: ActivityEntry) => void;
  log?: (line: string) => void;
  shell?: string;
  /** Injectable spawner (defaults to node-pty). */
  spawn?: PtySpawner;
}

/**
 * Bridges the expert's interactive terminal (in the dashboard) to a real shell
 * on the CUSTOMER's machine, over a dedicated WebRTC data channel. This is what
 * lets the expert run `claude`, `codex`, a dev server, a REPL — anything
 * interactive — in the real environment where the bug lives.
 *
 * It's gated by the Terminal scope: no shell spawns without it, and revoking
 * Terminal (or ending the session) kills the shell immediately. The customer's
 * live log records that a terminal was opened/closed — never the keystrokes or
 * output flowing through it.
 */
export class PtyBridge {
  readonly #channel: RawChannel;
  readonly #opts: PtyBridgeOptions;
  readonly #log: (line: string) => void;
  readonly #spawn: PtySpawner;
  #pty?: IPtyLike;
  #killed = false;

  constructor(channel: RawChannel, opts: PtyBridgeOptions) {
    this.#channel = channel;
    this.#opts = opts;
    this.#log = opts.log ?? (() => {});
    this.#spawn = opts.spawn ?? defaultSpawner;
    channel.onMessage((raw) => this.#onMessage(raw));
    channel.onClose(() => this.kill("channel closed"));
  }

  #send(msg: unknown): void {
    if (this.#channel.isOpen()) this.#channel.send(JSON.stringify(msg));
  }

  #onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg?.t) {
      case "open":
        this.#open(msg.cols, msg.rows);
        break;
      case "input":
        // Enforce the scope on every keystroke: a mid-session revoke kills the
        // shell, and any input that races in is dropped.
        if (!this.#pty) return;
        try {
          this.#opts.gate.checkTerminal();
        } catch {
          this.kill("terminal access revoked");
          return;
        }
        if (typeof msg.d === "string") this.#pty.write(msg.d);
        break;
      case "resize":
        if (this.#pty && isSize(msg.cols) && isSize(msg.rows)) {
          this.#pty.resize(msg.cols, msg.rows);
        }
        break;
      case "close":
        this.kill("expert closed the terminal");
        break;
    }
  }

  #open(cols?: number, rows?: number): void {
    if (this.#pty) return; // already open
    try {
      this.#opts.gate.checkTerminal();
    } catch (err) {
      this.#send({ t: "denied", reason: err instanceof Error ? err.message : "denied" });
      return;
    }
    const shell = this.#opts.shell ?? defaultShell();
    try {
      ensurePtyExecutable();
      this.#pty = this.#spawn({
        shell,
        cols: isSize(cols) ? cols! : 80,
        rows: isSize(rows) ? rows! : 24,
        cwd: this.#opts.projectDir,
      });
    } catch (err) {
      this.#send({ t: "denied", reason: `could not start a shell: ${errText(err)}` });
      return;
    }
    this.#killed = false;
    this.#pty.onData((data) => this.#send({ t: "data", d: data }));
    this.#pty.onExit(({ exitCode }) => {
      this.#send({ t: "exit", code: exitCode });
      this.#pty = undefined;
    });
    this.#send({ t: "ready", shell });
    this.#opts.onActivity({
      at: Date.now(),
      kind: "terminal_open",
      summary: "Expert opened an interactive terminal",
    });
    this.#log(`interactive terminal opened (${shell})`);
  }

  /** Terminate the shell (on revoke, expert close, channel close, or end). */
  kill(reason: string): void {
    if (this.#killed) return;
    this.#killed = true;
    if (this.#pty) {
      try {
        this.#pty.kill();
      } catch {
        /* ignore */
      }
      this.#pty = undefined;
      this.#opts.onActivity({
        at: Date.now(),
        kind: "terminal_close",
        summary: "Expert's interactive terminal closed",
      });
      this.#log(`interactive terminal killed: ${reason}`);
    }
    this.#send({ t: "exit", code: 0, reason });
  }
}

function isSize(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 2000;
}

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC ?? "powershell.exe";
  return process.env.SHELL ?? "/bin/bash";
}

let ensured = false;
/**
 * node-pty ships a `spawn-helper` binary on unix whose executable bit is
 * sometimes stripped during package extraction (a known pnpm/npm quirk). Fix
 * it once at runtime so spawning works regardless of how it was installed.
 */
function ensurePtyExecutable(): void {
  if (ensured || process.platform === "win32") return;
  ensured = true;
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("node-pty/package.json"));
    const candidates = [
      join(root, "prebuilds", "darwin-arm64", "spawn-helper"),
      join(root, "prebuilds", "darwin-x64", "spawn-helper"),
      join(root, "prebuilds", "linux-x64", "spawn-helper"),
      join(root, "prebuilds", "linux-arm64", "spawn-helper"),
      join(root, "build", "Release", "spawn-helper"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const mode = statSync(path).mode;
      if ((mode & 0o111) === 0) chmodSync(path, mode | 0o755);
    }
  } catch {
    /* best effort */
  }
}

const defaultSpawner: PtySpawner = (opts) => {
  const require = createRequire(import.meta.url);
  const nodePty = require("node-pty") as typeof import("node-pty");
  return nodePty.spawn(opts.shell, [], {
    name: "xterm-color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: process.env as Record<string, string>,
  });
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
