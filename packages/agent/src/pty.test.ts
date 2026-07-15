import { beforeEach, describe, expect, it } from "vitest";
import { PermissionGate } from "./permissions";
import { PtyBridge, type IPtyLike, type PtySpawner } from "./pty";
import { createLoopbackPair, type RawChannel } from "./webrtc/channel";
import type { ActivityEntry } from "./types";

/** A fake shell that records what the bridge does to it. */
class FakePty implements IPtyLike {
  dataCb?: (d: string) => void;
  exitCb?: (e: { exitCode: number }) => void;
  written: string[] = [];
  resized?: [number, number];
  killed = false;
  spawnOpts: any;
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  onExit(cb: (e: { exitCode: number }) => void) { this.exitCb = cb; }
  write(d: string) { this.written.push(d); }
  resize(c: number, r: number) { this.resized = [c, r]; }
  kill() { this.killed = true; }
  emit(d: string) { this.dataCb?.(d); }
}

let gate: PermissionGate;
let activity: ActivityEntry[];
let expertSide: RawChannel;
let agentSide: RawChannel;
let lastPty: FakePty | undefined;
let spawner: PtySpawner;
let received: any[];

function makeBridge() {
  return new PtyBridge(agentSide, {
    gate,
    projectDir: "/home/jordan/projects/landing-page",
    onActivity: (e) => activity.push(e),
    spawn: spawner,
  });
}

function send(msg: unknown) {
  expertSide.send(JSON.stringify(msg));
}

async function flush() {
  await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  gate = new PermissionGate("/home/jordan/projects/landing-page");
  activity = [];
  received = [];
  lastPty = undefined;
  [expertSide, agentSide] = createLoopbackPair("pty");
  expertSide.onMessage((raw: string) => received.push(JSON.parse(raw)));
  spawner = (opts) => {
    const p = new FakePty();
    p.spawnOpts = opts;
    lastPty = p;
    return p;
  };
});

describe("PtyBridge open", () => {
  it("denies open without the terminal scope", async () => {
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    expect(received.some((m) => m.t === "denied")).toBe(true);
    expect(lastPty).toBeUndefined();
  });

  it("spawns a shell in the project directory when terminal is granted", async () => {
    gate.grant({ files: false, terminal: true, browser: false });
    makeBridge();
    send({ t: "open", cols: 100, rows: 30 });
    await flush();
    expect(lastPty).toBeDefined();
    expect(lastPty!.spawnOpts.cwd).toBe("/home/jordan/projects/landing-page");
    expect(lastPty!.spawnOpts.cols).toBe(100);
    expect(received.some((m) => m.t === "ready")).toBe(true);
    expect(activity.some((a) => a.kind === "terminal_open")).toBe(true);
  });

  it("logs only that a terminal opened, not any I/O", async () => {
    gate.grant({ files: false, terminal: true, browser: false });
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    const entry = activity.find((a) => a.kind === "terminal_open")!;
    expect(entry.summary).toMatch(/interactive terminal/i);
  });
});

describe("PtyBridge streaming", () => {
  beforeEach(() => {
    gate.grant({ files: false, terminal: true, browser: false });
  });

  it("streams pty output to the expert", async () => {
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    lastPty!.emit("$ claude\r\n");
    await flush();
    expect(received.some((m) => m.t === "data" && m.d === "$ claude\r\n")).toBe(true);
  });

  it("writes expert input to the shell", async () => {
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    send({ t: "input", d: "ls -la\r" });
    await flush();
    expect(lastPty!.written).toContain("ls -la\r");
  });

  it("resizes the shell", async () => {
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    send({ t: "resize", cols: 120, rows: 40 });
    await flush();
    expect(lastPty!.resized).toEqual([120, 40]);
  });

  it("forwards the shell exit to the expert", async () => {
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    lastPty!.exitCb!({ exitCode: 0 });
    await flush();
    expect(received.some((m) => m.t === "exit")).toBe(true);
  });
});

describe("PtyBridge revocation", () => {
  it("kills the shell and drops input when terminal is revoked mid-session", async () => {
    gate.grant({ files: false, terminal: true, browser: false });
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    gate.revoke("terminal");
    send({ t: "input", d: "whoami\r" });
    await flush();
    expect(lastPty!.killed).toBe(true);
    expect(lastPty!.written).not.toContain("whoami\r");
    expect(activity.some((a) => a.kind === "terminal_close")).toBe(true);
  });

  it("kills the shell when the channel closes", async () => {
    gate.grant({ files: false, terminal: true, browser: false });
    makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    expertSide.close();
    await flush();
    expect(lastPty!.killed).toBe(true);
  });

  it("kills the shell on explicit close", async () => {
    gate.grant({ files: false, terminal: true, browser: false });
    const bridge = makeBridge();
    send({ t: "open", cols: 80, rows: 24 });
    await flush();
    bridge.kill("session ended");
    expect(lastPty!.killed).toBe(true);
  });
});
