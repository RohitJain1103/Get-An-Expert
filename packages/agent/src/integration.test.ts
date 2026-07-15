/**
 * Full peer-to-peer flow: real relay + real AgentSession + a Node-side expert,
 * with a genuine WebRTC handshake (node-datachannel on both ends) carrying MCP.
 * This proves the design end-to-end — the relay only signals; the expert's MCP
 * tool calls travel peer-to-peer over the data channel.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createRelay, type Relay } from "get-an-expert-relay";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { AgentSession } from "./agent-session";
import { NodePeer, cleanupWebrtc } from "./webrtc/peer";
import { DataChannelTransport } from "./webrtc/transport";
import type { RawChannel } from "./webrtc/channel";

const TOKEN = "integration-token";

let relay: Relay;
let relayUrl: string;
let projectDir: string;
let session: AgentSession;
let expertWs: WebSocket;
let expertPeer: NodePeer | undefined;
let expertClient: Client | undefined;
let expertPty: RawChannel | undefined;

beforeEach(async () => {
  relay = createRelay({ expertTokens: [TOKEN] });
  await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", r));
  const port = (relay.server.address() as { port: number }).port;
  relayUrl = `ws://127.0.0.1:${port}`;

  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-int-")));
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src", "Hero.tsx"), "import { HeroImage } from '@/assets';\n");
  writeFileSync(join(projectDir, "package.json"), '{"name":"landing-page"}\n');
});

/** Bound an async step so a slow native close can't hang the whole hook. */
function bounded<T>(p: Promise<T> | undefined, ms: number): Promise<unknown> {
  return Promise.race([p ?? Promise.resolve(), new Promise((r) => setTimeout(r, ms))]);
}

afterEach(async () => {
  // Tear the peer down first so the MCP client's transport is already gone
  // and its close resolves immediately.
  expertPeer?.close();
  expertWs?.close();
  await bounded(expertClient?.close().catch(() => {}), 2000);
  expertClient = undefined;
  expertPeer = undefined;
  expertPty = undefined;
  await bounded(session?.end().catch(() => {}), 6000);
  relay.server.closeAllConnections?.();
  await bounded(new Promise<void>((r) => relay.server.close(() => r())), 4000);
}, 20_000);

/** Wait until the pty data channel has been established. */
async function waitForPty(): Promise<RawChannel> {
  for (let i = 0; i < 200; i++) {
    if (expertPty) return expertPty;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("pty channel never opened");
}

/** Drive the expert side: auth, claim, WebRTC offer, and an MCP client. */
function connectExpert(sessionId: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relayUrl}/expert`);
    expertWs = ws;
    const timer = setTimeout(() => reject(new Error("expert connect timeout")), 20_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token: TOKEN, name: "Priya Sharma" }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case "auth-ok":
          ws.send(JSON.stringify({ type: "claim", sessionId }));
          break;
        case "claimed": {
          // Offerer creates both channels (mcp + pty) and drives the handshake.
          const peer = new NodePeer({
            role: "offerer",
            iceServers: [],
            labels: ["mcp", "pty"],
            sendSignal: (payload) =>
              ws.send(JSON.stringify({ type: "signal", sessionId, payload })),
          });
          expertPeer = peer;
          peer.onError((err) => reject(err));
          peer.onChannel(async (channel: RawChannel) => {
            if (channel.label === "pty") {
              expertPty = channel;
              return;
            }
            try {
              const client = new Client({ name: "get-an-expert-dashboard", version: "0.0.0" });
              await client.connect(new DataChannelTransport(channel));
              clearTimeout(timer);
              expertClient = client;
              resolve(client);
            } catch (err) {
              reject(err);
            }
          });
          break;
        }
        case "signal":
          expertPeer?.handleSignal(msg.payload);
          break;
      }
    });

    ws.on("error", reject);
  });
}

async function startSessionAndExpert(): Promise<Client> {
  session = new AgentSession({
    relayUrl,
    projectDir,
    customerName: "Jordan Lee",
    // Localhost-only ICE keeps the handshake fast and network-independent.
    peerFactory: ({ role, sendSignal }) =>
      new NodePeer({ role, iceServers: [], sendSignal }),
  });
  const { sessionId } = await session.requestExpert("Build failing on HeroImage import");
  session.grant({ files: true, terminal: true, browser: true, browserPort: 3000 });
  return connectExpert(sessionId);
}

describe("end-to-end peer-to-peer session", () => {
  it("connects an expert and exposes the six tools over WebRTC", async () => {
    const client = await startSessionAndExpert();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "browser_console",
      "browser_screenshot",
      "list_files",
      "read_file",
      "run_command",
      "write_file",
    ]);
  }, 30_000);

  it("runs a real interactive shell on the customer's machine over WebRTC", async () => {
    await startSessionAndExpert();
    const pty = await waitForPty();
    let output = "";
    pty.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (msg.t === "data") output += msg.d;
    });

    pty.send(JSON.stringify({ t: "open", cols: 80, rows: 24 }));
    // Wait for the shell prompt / ready.
    await vi.waitFor(() => expect(output.length).toBeGreaterThan(0), { timeout: 8000 });

    pty.send(JSON.stringify({ t: "input", d: "echo interactive-pty-works\r" }));
    await vi.waitFor(() => expect(output).toContain("interactive-pty-works"), { timeout: 8000 });
  }, 30_000);

  it("kills the interactive shell when Terminal is revoked", async () => {
    await startSessionAndExpert();
    const pty = await waitForPty();
    let exited = false;
    pty.onMessage((raw) => {
      if (JSON.parse(raw).t === "exit") exited = true;
    });
    pty.send(JSON.stringify({ t: "open", cols: 80, rows: 24 }));
    await new Promise((r) => setTimeout(r, 500));
    session.revoke("terminal");
    await vi.waitFor(() => expect(exited).toBe(true), { timeout: 8000 });
  }, 30_000);

  it("lets the expert read, fix, and verify on the customer's machine", async () => {
    const client = await startSessionAndExpert();

    const read: any = await client.callTool({
      name: "read_file",
      arguments: { path: "src/Hero.tsx" },
    });
    expect(JSON.parse(read.content[0].text).content).toContain("HeroImage");

    await client.callTool({
      name: "write_file",
      arguments: { path: "src/Hero.tsx", content: "import { HeroImg } from '@/assets';\n" },
    });
    expect(readFileSync(join(projectDir, "src/Hero.tsx"), "utf8")).toContain("HeroImg");

    const run: any = await client.callTool({
      name: "run_command",
      arguments: { command: "cat package.json" },
    });
    expect(JSON.parse(run.content[0].text).stdout).toContain("landing-page");
  }, 30_000);

  it("reflects a mid-session revocation on the customer's side", async () => {
    const client = await startSessionAndExpert();
    session.revoke("files");
    const res: any = await client.callTool({
      name: "read_file",
      arguments: { path: "src/Hero.tsx" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/permission denied/i);
  }, 30_000);

  it("relays activity so the customer sees what the expert did", async () => {
    const client = await startSessionAndExpert();
    await client.callTool({ name: "read_file", arguments: { path: "src/Hero.tsx" } });
    await client.callTool({
      name: "write_file",
      arguments: { path: "src/Hero.tsx", content: "fixed\n" },
    });
    // Metadata is relayed asynchronously; allow it to arrive.
    await new Promise((r) => setTimeout(r, 200));
    const status = relay.store.get(session.sessionId!);
    expect(status?.activity.some((a) => a.kind === "read_file")).toBe(true);
    expect(status?.activity.some((a) => a.kind === "write_file")).toBe(true);
  }, 30_000);

  it("summarizes the session on end", async () => {
    const client = await startSessionAndExpert();
    await client.callTool({
      name: "write_file",
      arguments: { path: "src/Hero.tsx", content: "import { HeroImg } from '@/assets';\n" },
    });
    await client.callTool({ name: "run_command", arguments: { command: "true" } });
    await new Promise((r) => setTimeout(r, 100));

    const sessionId = session.sessionId!;
    const summary = await session.end("fixed");
    expect(summary.filesModified).toContain("src/Hero.tsx");
    expect(summary.commandsRun).toContain("true");
    expect(summary.expertName).toBe("Priya Sharma");
    // The relay ends the session on the agent's end/close message, which is
    // processed asynchronously after end() resolves.
    await vi.waitFor(() =>
      expect(relay.store.get(sessionId)?.status).toBe("ended"),
    );
  }, 30_000);
});

afterAll(() => {
  cleanupWebrtc();
});
