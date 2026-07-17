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
  writeFileSync(join(dashboardDir, "chat.html"), "<h1>get-an-expert customer chat</h1>");
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
  return {
    agent,
    sessionId: reg.sessionId as string,
    customerToken: reg.customerToken as string,
  };
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

async function connectedCustomer(sessionId: string, token: string) {
  const customer = await connect("/customer");
  send(customer, { type: "hello", sessionId, token });
  const hello = await nextMessage(customer);
  expect(hello.type).toBe("hello-ok");
  return { customer, hello };
}

async function claimedExpert(sessionId: string, name = "Priya Sharma") {
  const { expert } = await authedExpert(name);
  send(expert, { type: "claim", sessionId });
  await waitFor(expert, (m) => m.type === "claimed");
  const history = await waitFor(expert, (m) => m.type === "chat-history");
  return { expert, history };
}

describe("customer token", () => {
  it("includes a 32-hex customerToken in the registered reply", async () => {
    const { customerToken } = await registeredAgent();
    expect(customerToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("mints a distinct token per session", async () => {
    const a = await registeredAgent("Jordan Lee");
    const b = await registeredAgent("Taylor Kim");
    expect(a.customerToken).not.toBe(b.customerToken);
  });

  it("never leaks the customerToken or chat history to experts via the queue", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    send(customer, { type: "chat", text: "a message before any expert" });
    await waitFor(customer, (m) => m.type === "chat");

    const { expert, queue } = await authedExpert();
    expect(queue.sessions).toHaveLength(1);
    const keys = Object.keys(queue.sessions[0]);
    expect(keys).not.toContain("customerToken");
    expect(keys).not.toContain("chat");
    expect(JSON.stringify(queue)).not.toContain(customerToken);

    // Broadcast queue updates must not leak either.
    send(expert, { type: "claim", sessionId });
    const update = await waitFor(expert, (m) => m.type === "queue");
    expect(JSON.stringify(update)).not.toContain(customerToken);
    expect(Object.keys(update.sessions[0])).not.toContain("chat");
  });
});

describe("customer hello", () => {
  it("rejects a wrong token with hello-failed and closes", async () => {
    const { sessionId } = await registeredAgent();
    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: "0".repeat(32) });
    const res = await nextMessage(customer);
    expect(res.type).toBe("hello-failed");
    await waitForClose(customer);
  });

  it("rejects an unknown session with hello-failed and closes", async () => {
    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId: "nope", token: "0".repeat(32) });
    const res = await nextMessage(customer);
    expect(res.type).toBe("hello-failed");
    await waitForClose(customer);
  });

  it("accepts the right token with hello-ok, waiting status, and empty history", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { hello } = await connectedCustomer(sessionId, customerToken);
    expect(hello.status).toBe("waiting");
    expect(hello.history).toEqual([]);
    expect(hello.expertName).toBeUndefined();
  });

  it("closes the connection when chat arrives before hello", async () => {
    await registeredAgent();
    const customer = await connect("/customer");
    send(customer, { type: "chat", text: "sneaky" });
    await waitForClose(customer);
  });

  it("reports ended status when the session already ended", async () => {
    const { agent, sessionId, customerToken } = await registeredAgent();
    // An explicit end (not a mere disconnect) is what ends a session now.
    send(agent, { type: "end", reason: "customer ended" });
    const deadline = Date.now() + 3000;
    while (relay.store.get(sessionId)?.status !== "ended") {
      if (Date.now() > deadline) throw new Error("session did not end");
      await new Promise((r) => setTimeout(r, 10));
    }
    const { hello } = await connectedCustomer(sessionId, customerToken);
    expect(hello.status).toBe("ended");
  });
});

describe("chat flow", () => {
  it("stores customer messages before a claim and replays them as chat-history", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);

    send(customer, { type: "chat", text: "hello, anyone there?" });
    const echo = await waitFor(customer, (m) => m.type === "chat");
    expect(echo.message.from).toBe("customer");
    expect(echo.message.name).toBe("Jordan Lee");
    expect(echo.message.text).toBe("hello, anyone there?");
    expect(echo.message.at).toBeGreaterThan(0);
    expect(relay.store.get(sessionId)?.chat).toHaveLength(1);

    const { history } = await claimedExpert(sessionId);
    expect(history.sessionId).toBe(sessionId);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].text).toBe("hello, anyone there?");

    const joined = await waitFor(customer, (m) => m.type === "expert-joined");
    expect(joined.expertName).toBe("Priya Sharma");
  });

  it("replays history on a fresh hello (reconnect path)", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    send(customer, { type: "chat", text: "message one" });
    await waitFor(customer, (m) => m.type === "chat");
    customer.close();

    const { hello } = await connectedCustomer(sessionId, customerToken);
    expect(hello.history).toHaveLength(1);
    expect(hello.history[0].text).toBe("message one");
  });

  it("flows both directions after a claim, echoing to the sender on each side", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await claimedExpert(sessionId);
    await waitFor(customer, (m) => m.type === "expert-joined");

    send(customer, { type: "chat", text: "it broke again" });
    const toExpert = await waitFor(expert, (m) => m.type === "chat");
    expect(toExpert.sessionId).toBe(sessionId);
    expect(toExpert.message.from).toBe("customer");
    expect(toExpert.message.text).toBe("it broke again");
    const customerEcho = await waitFor(customer, (m) => m.type === "chat");
    expect(customerEcho.message.text).toBe("it broke again");

    send(expert, { type: "chat", sessionId, text: "on it — checking the build" });
    const toCustomer = await waitFor(customer, (m) => m.type === "chat");
    expect(toCustomer.message.from).toBe("expert");
    expect(toCustomer.message.name).toBe("Priya Sharma");
    expect(toCustomer.message.text).toBe("on it — checking the build");
    const expertEcho = await waitFor(expert, (m) => m.type === "chat");
    expect(expertEcho.sessionId).toBe(sessionId);
    expect(expertEcho.message.from).toBe("expert");

    expect(relay.store.get(sessionId)?.chat).toHaveLength(2);
  });

  it("refuses expert chat for sessions the expert has not claimed", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await authedExpert();

    send(expert, { type: "chat", sessionId, text: "not mine to chat in" });
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.store.get(sessionId)?.chat).toEqual([]);
    expect(buffers.get(customer)!.filter((m) => m.type === "chat")).toEqual([]);
  });

  it("redacts secrets before storing or forwarding, in every direction", async () => {
    const fakeKey = `sk-ant-api03-${"a".repeat(20)}`;
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await claimedExpert(sessionId);
    await waitFor(customer, (m) => m.type === "expert-joined");

    send(customer, { type: "chat", text: `my key is ${fakeKey} — help` });
    const toExpert = await waitFor(expert, (m) => m.type === "chat");
    const customerEcho = await waitFor(customer, (m) => m.type === "chat");
    for (const received of [toExpert.message.text, customerEcho.message.text]) {
      expect(received).not.toContain(fakeKey);
      expect(received).toContain("[REDACTED:anthropic-api-key]");
    }
    const stored = relay.store.get(sessionId)!.chat;
    expect(stored[0].text).not.toContain(fakeKey);
    expect(stored[0].text).toContain("[REDACTED:anthropic-api-key]");

    send(expert, { type: "chat", sessionId, text: `try ${fakeKey} instead` });
    const toCustomer = await waitFor(customer, (m) => m.type === "chat");
    expect(toCustomer.message.text).not.toContain(fakeKey);
    expect(toCustomer.message.text).toContain("[REDACTED:anthropic-api-key]");
    expect(relay.store.get(sessionId)!.chat[1].text).not.toContain(fakeKey);
  });
});

describe("session lifecycle notifications", () => {
  it("tells customer sockets when the expert leaves (release)", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await claimedExpert(sessionId);
    await waitFor(customer, (m) => m.type === "expert-joined");

    send(expert, { type: "release", sessionId });
    await waitFor(customer, (m) => m.type === "expert-left");
  });

  it("tells customer sockets when the expert disconnects", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await claimedExpert(sessionId);
    await waitFor(customer, (m) => m.type === "expert-joined");

    expert.close();
    await waitFor(customer, (m) => m.type === "expert-left");
  });

  it("sends session-ended to customer sockets and refuses further chat", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    const { expert } = await claimedExpert(sessionId);
    await waitFor(customer, (m) => m.type === "expert-joined");

    send(expert, { type: "end-session", sessionId, reason: "Fixed" });
    const ended = await waitFor(customer, (m) => m.type === "session-ended");
    expect(ended.reason).toBe("Fixed");

    // The relay closes the customer socket right after the ended notice, so no
    // further chat is possible and the store keeps no messages.
    await waitForClose(customer);
    expect(relay.store.get(sessionId)?.chat).toEqual([]);

    // The (former) expert can't chat into an ended session either.
    send(expert, { type: "chat", sessionId, text: "gone" });
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.store.get(sessionId)?.chat).toEqual([]);
  });
});

describe("chat rate limiting", () => {
  it("drops customer chat messages beyond the per-socket burst", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const { customer } = await connectedCustomer(sessionId, customerToken);
    // Fire well past the burst cap synchronously (same time window).
    for (let i = 0; i < 40; i += 1) {
      send(customer, { type: "chat", text: `m${i}` });
    }
    await new Promise((r) => setTimeout(r, 300));
    const stored = relay.store.get(sessionId)?.chat ?? [];
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThanOrEqual(20);
  });
});

describe("chat page", () => {
  it("serves chat.html at the pretty /chat URL", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("get-an-expert customer chat");
  });

  it("still 404s unrelated paths", async () => {
    const res = await fetch(`${baseUrl}/chatter`);
    expect(res.status).toBe(404);
  });
});
