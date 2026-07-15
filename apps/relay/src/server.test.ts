import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelay, type Relay } from "./server";

const TOKEN = "test-expert-token";

let relay: Relay;
let baseUrl: string;
let wsUrl: string;
let sockets: WebSocket[];
let buffers: Map<WebSocket, any[]>;

beforeEach(async () => {
  const dashboardDir = mkdtempSync(join(tmpdir(), "get-an-expert-dash-"));
  writeFileSync(join(dashboardDir, "index.html"), "<h1>get-an-expert dashboard</h1>");
  relay = createRelay({ expertTokens: [TOKEN], dashboardDir });
  await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", r));
  const addr = relay.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}`;
  sockets = [];
  buffers = new Map();
});

afterEach(async () => {
  for (const ws of sockets) ws.close();
  await new Promise<void>((r) => relay.server.close(() => r()));
});

/** Connect and buffer every incoming message so none are lost between reads. */
function connect(path: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsUrl}${path}`);
  sockets.push(ws);
  buffers.set(ws, []);
  ws.on("message", (data) => {
    buffers.get(ws)!.push(JSON.parse(data.toString()));
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  const buffer = buffers.get(ws)!;
  while (Date.now() < deadline) {
    if (buffer.length > 0) return buffer.shift();
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout waiting for message");
}

/** Consume buffered messages until one matches the predicate. */
async function waitFor(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 3000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("timeout waiting for matching message");
    const msg = await nextMessage(ws, remaining);
    if (predicate(msg)) return msg;
  }
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

async function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ws.readyState === WebSocket.CLOSED) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout waiting for close");
}

async function registeredAgent(customerName = "Jordan Lee") {
  const agent = await connect("/agent");
  send(agent, {
    type: "register",
    customerName,
    projectDir: "~/projects/landing-page",
    issue: "Build failing",
  });
  const reg = await nextMessage(agent);
  expect(reg.type).toBe("registered");
  return { agent, sessionId: reg.sessionId as string };
}

async function authedExpert(name = "Priya Sharma") {
  const expert = await connect("/expert");
  send(expert, { type: "auth", token: TOKEN, name });
  const ok = await nextMessage(expert);
  expect(ok.type).toBe("auth-ok");
  const queue = await nextMessage(expert);
  expect(queue.type).toBe("queue");
  return { expert, queue };
}

describe("agent registration", () => {
  it("registers a session and returns its id", async () => {
    const { sessionId } = await registeredAgent();
    expect(sessionId).toBeTruthy();
    expect(relay.store.get(sessionId)?.status).toBe("waiting");
  });

  it("closes the connection on an invalid first message", async () => {
    const agent = await connect("/agent");
    send(agent, { type: "signal", payload: {} });
    await waitForClose(agent);
    expect(agent.readyState).toBe(WebSocket.CLOSED);
  });
});

describe("expert auth", () => {
  it("rejects a bad token and closes", async () => {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: "wrong", name: "Mallory" });
    const res = await nextMessage(expert);
    expect(res.type).toBe("auth-failed");
    await waitForClose(expert);
  });

  it("sends the queue snapshot after auth", async () => {
    await registeredAgent();
    const { queue } = await authedExpert();
    expect(queue.sessions).toHaveLength(1);
    expect(queue.sessions[0].customerName).toBe("Jordan Lee");
    expect(queue.sessions[0].status).toBe("waiting");
  });

  it("does not include signal payloads or file data in queue entries", async () => {
    await registeredAgent();
    const { queue } = await authedExpert();
    const keys = Object.keys(queue.sessions[0]);
    expect(keys).not.toContain("payload");
  });
});

describe("claiming sessions", () => {
  it("notifies the agent when an expert claims its session", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    const claimed = await waitFor(expert, (m) => m.type === "claimed");
    expect(claimed.sessionId).toBe(sessionId);
    const joined = await waitFor(agent, (m) => m.type === "expert-joined");
    expect(joined.expertName).toBe("Priya Sharma");
  });

  it("fails the claim when another expert already holds the session", async () => {
    const { sessionId } = await registeredAgent();
    const { expert: first } = await authedExpert("Priya Sharma");
    const { expert: second } = await authedExpert("Sam Other");
    send(first, { type: "claim", sessionId });
    await waitFor(first, (m) => m.type === "claimed");
    send(second, { type: "claim", sessionId });
    const failed = await waitFor(second, (m) => m.type === "claim-failed");
    expect(failed.reason).toMatch(/already/i);
  });

  it("returns the session to waiting when the expert releases it", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");
    send(expert, { type: "release", sessionId });
    await waitFor(agent, (m) => m.type === "expert-left");
    expect(relay.store.get(sessionId)?.status).toBe("waiting");
  });
});

describe("signaling passthrough", () => {
  it("routes signal payloads opaquely in both directions", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");

    const offer = { kind: "description", sdp: "v=0 fake-offer", sdpType: "offer" };
    send(expert, { type: "signal", sessionId, payload: offer });
    const toAgent = await waitFor(agent, (m) => m.type === "signal");
    expect(toAgent.payload).toEqual(offer);

    const answer = { kind: "description", sdp: "v=0 fake-answer", sdpType: "answer" };
    send(agent, { type: "signal", payload: answer });
    const toExpert = await waitFor(expert, (m) => m.type === "signal");
    expect(toExpert.sessionId).toBe(sessionId);
    expect(toExpert.payload).toEqual(answer);
  });

  it("drops signals for sessions the expert has not claimed", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "signal", sessionId, payload: { sneaky: true } });
    // The agent must receive nothing; give it a moment then check its buffer.
    await new Promise((r) => setTimeout(r, 300));
    expect(buffers.get(agent)).toEqual([]);
  });
});

describe("session metadata", () => {
  it("records permission grants and broadcasts queue updates", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(agent, {
      type: "metadata",
      permissions: { files: true, terminal: true, browser: true, browserPort: 3000 },
    });
    const update = await waitFor(
      expert,
      (m) => m.type === "queue" && m.sessions[0]?.permissions.files === true,
    );
    expect(update.sessions[0].permissions.browserPort).toBe(3000);
    expect(relay.store.get(sessionId)?.permissions.terminal).toBe(true);
  });

  it("records activity summaries", async () => {
    const { agent, sessionId } = await registeredAgent();
    send(agent, {
      type: "metadata",
      activity: { kind: "read_file", summary: "Expert reading: src/components/Hero.tsx" },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(relay.store.get(sessionId)?.activity).toHaveLength(1);
  });
});

describe("session end", () => {
  it("ends the session and tells the expert when the agent disconnects", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    agent.close();
    const ended = await waitFor(expert, (m) => m.type === "session-ended");
    expect(ended.sessionId).toBe(sessionId);
    expect(relay.store.get(sessionId)?.status).toBe("ended");
  });

  it("ends the session and tells the agent when the expert ends it", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");
    send(expert, { type: "end-session", sessionId, reason: "Fixed" });
    const ended = await waitFor(agent, (m) => m.type === "session-ended");
    expect(ended.reason).toBe("Fixed");
    expect(relay.store.get(sessionId)?.status).toBe("ended");
  });

  it("returns claimed sessions to waiting when the expert disconnects", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");
    expert.close();
    await waitFor(agent, (m) => m.type === "expert-left");
    expect(relay.store.get(sessionId)?.status).toBe("waiting");
  });
});

describe("http", () => {
  it("serves the dashboard at /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("get-an-expert dashboard");
  });

  it("responds to /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
  });

  it("refuses path traversal outside the dashboard dir", async () => {
    const res = await fetch(`${baseUrl}/..%2f..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
  });
});
