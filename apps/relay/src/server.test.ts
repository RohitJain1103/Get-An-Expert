import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelay, type Relay, type RelayOptions } from "./server";

const TOKEN = "test-expert-token";

let relay: Relay;
let baseUrl: string;
let wsUrl: string;
let sockets: WebSocket[];
let buffers: Map<WebSocket, any[]>;
let relays: Relay[];

/** Boot a relay on an ephemeral port; tracked for teardown. */
async function launch(
  options: Partial<RelayOptions> = {},
): Promise<{ relay: Relay; wsUrl: string; baseUrl: string }> {
  const dashboardDir = mkdtempSync(join(tmpdir(), "get-an-expert-dash-"));
  writeFileSync(join(dashboardDir, "index.html"), "<h1>get-an-expert dashboard</h1>");
  const r = createRelay({ expertTokens: [TOKEN], dashboardDir, ...options });
  relays.push(r);
  await new Promise<void>((res) => r.server.listen(0, "127.0.0.1", res));
  const addr = r.server.address() as { port: number };
  return {
    relay: r,
    wsUrl: `ws://127.0.0.1:${addr.port}`,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

beforeEach(async () => {
  relays = [];
  sockets = [];
  buffers = new Map();
  ({ relay, wsUrl, baseUrl } = await launch());
});

afterEach(async () => {
  for (const ws of sockets) ws.close();
  await Promise.all(
    relays.map((r) => new Promise<void>((res) => r.server.close(() => res()))),
  );
});

/** Connect and buffer every incoming message so none are lost between reads. */
function connect(path: string, url: string = wsUrl): Promise<WebSocket> {
  const ws = new WebSocket(`${url}${path}`);
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

/** Poll until a predicate holds (used to observe async store transitions). */
async function pollUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout waiting for condition");
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
    resumeToken: reg.resumeToken as string,
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

describe("expert roster identity", () => {
  it("auth with an expertId adopts the roster identity", async () => {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: TOKEN, name: "Whoever", expertId: "rohit" });
    const ok = await waitFor(expert, (m) => m.type === "auth-ok");
    expect(ok.name).toBe("Rohit Jain");
    expect(ok.expert).toEqual(expect.objectContaining({ id: "rohit" }));
  });

  it("auth without expertId keeps today's self-declared name", async () => {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: TOKEN, name: "Whoever" });
    const ok = await waitFor(expert, (m) => m.type === "auth-ok");
    expect(ok.name).toBe("Whoever");
    expect(ok.expert).toBeUndefined();
  });

  it("auth with an unknown expertId falls back to the declared name", async () => {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: TOKEN, name: "Whoever", expertId: "nobody" });
    const ok = await waitFor(expert, (m) => m.type === "auth-ok");
    expect(ok.name).toBe("Whoever");
    expect(ok.expert).toBeUndefined();
  });
});

describe("customer activity feed", () => {
  async function registerWithToken() {
    const agent = await connect("/agent");
    send(agent, {
      type: "register",
      customerName: "Jordan Lee",
      projectDir: "~/projects/landing-page",
      issue: "Build failing",
    });
    const reg = await nextMessage(agent);
    expect(reg.type).toBe("registered");
    return { agent, sessionId: reg.sessionId as string, customerToken: reg.customerToken as string };
  }

  it("pushes expert activity to the customer chat socket in real time", async () => {
    const { agent, sessionId, customerToken } = await registerWithToken();
    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    const hello = await waitFor(customer, (m) => m.type === "hello-ok");
    expect(Array.isArray(hello.activity)).toBe(true);

    send(agent, {
      type: "metadata",
      activity: { kind: "read_file", summary: "Expert reading: src/app.ts" },
    });
    const act = await waitFor(customer, (m) => m.type === "activity");
    expect(act.entry.summary).toBe("Expert reading: src/app.ts");
    expect(typeof act.entry.at).toBe("number");
  });

  it("seeds activity history in hello-ok for a customer who joins mid-session", async () => {
    const { agent, sessionId, customerToken } = await registerWithToken();
    send(agent, {
      type: "metadata",
      activity: { kind: "write_file", summary: "Expert edited: src/app.ts" },
    });
    // Let the relay process the metadata before the customer connects.
    await new Promise((r) => setTimeout(r, 50));

    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    const hello = await waitFor(customer, (m) => m.type === "hello-ok");
    expect(
      hello.activity.some((a: any) => a.summary === "Expert edited: src/app.ts"),
    ).toBe(true);
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

describe("claim carries the roster profile", () => {
  async function rohitExpert() {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: TOKEN, name: "Whoever", expertId: "rohit" });
    await waitFor(expert, (m) => m.type === "auth-ok");
    await waitFor(expert, (m) => m.type === "queue");
    return expert;
  }

  it("claim fans the full profile out to agent and chat sockets", async () => {
    const { agent, sessionId, customerToken } = await registeredAgent();
    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    await waitFor(customer, (m) => m.type === "hello-ok");

    const expert = await rohitExpert();
    send(expert, { type: "claim", sessionId });

    const toAgent = await waitFor(agent, (m) => m.type === "expert-joined");
    expect(toAgent.expertName).toBe("Rohit Jain");
    expect(toAgent.expert).toEqual(
      expect.objectContaining({ photo: "/experts/rohit.jpg" }),
    );
    const toChat = await waitFor(customer, (m) => m.type === "expert-joined");
    expect(toChat.expert).toEqual(expect.objectContaining({ id: "rohit" }));
  });

  it("hello-ok includes bench, permissions, issue, and expert when claimed", async () => {
    const { agent, sessionId, customerToken } = await registeredAgent();
    send(agent, {
      type: "metadata",
      permissions: { files: true, terminal: false, browser: false },
    });
    const expert = await rohitExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");

    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    const hello = await waitFor(customer, (m) => m.type === "hello-ok");
    expect(hello.bench).toHaveLength(6);
    expect(hello.expert?.id).toBe("rohit");
    expect(hello.permissions).toEqual(expect.objectContaining({ files: true }));
    expect(hello.issue).toBe("Build failing");
  });

  it("hello-ok bench never includes token material", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    const hello = await waitFor(customer, (m) => m.type === "hello-ok");
    expect(JSON.stringify(hello)).not.toContain(TOKEN);
  });
});

describe("two-way issue editing", () => {
  async function rohitExpert() {
    const expert = await connect("/expert");
    send(expert, { type: "auth", token: TOKEN, name: "Whoever", expertId: "rohit" });
    await waitFor(expert, (m) => m.type === "auth-ok");
    await waitFor(expert, (m) => m.type === "queue");
    return expert;
  }

  it("customer edit-issue updates, redacts, and broadcasts issue-updated", async () => {
    const { agent, sessionId, customerToken } = await registeredAgent();
    const expert = await rohitExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");

    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    await waitFor(customer, (m) => m.type === "hello-ok");

    const secret = `sk-ant-${"a".repeat(24)}`;
    send(customer, { type: "edit-issue", text: `please fix ${secret} now` });

    const toAgent = await waitFor(agent, (m) => m.type === "issue-updated");
    expect(toAgent.by).toBe("customer");
    expect(toAgent.issue).not.toContain(secret);
    expect(toAgent.issue).toContain("please fix");
    const toExpert = await waitFor(expert, (m) => m.type === "issue-updated");
    expect(toExpert.by).toBe("customer");
    const toChat = await waitFor(customer, (m) => m.type === "issue-updated");
    expect(toChat.by).toBe("customer");
    expect(typeof toChat.at).toBe("number");

    const session = relay.store.get(sessionId);
    expect(session?.issueEditedBy).toBe("customer");
    expect(session?.issue).not.toContain(secret);
  });

  it("expert edit with a stale baseAt against a customer edit is rejected", async () => {
    const { agent, sessionId, customerToken } = await registeredAgent();
    const expert = await rohitExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");

    const customer = await connect("/customer");
    send(customer, { type: "hello", sessionId, token: customerToken });
    await waitFor(customer, (m) => m.type === "hello-ok");

    // Customer edits at t1.
    send(customer, { type: "edit-issue", text: "customer version wins" });
    await waitFor(agent, (m) => m.type === "issue-updated");
    const t1 = relay.store.get(sessionId)!.issueEditedAt!;

    // Expert edits with a baseAt from before the customer's edit.
    send(expert, {
      type: "edit-issue",
      sessionId,
      text: "expert version loses",
      baseAt: t1 - 5000,
    });
    const rej = await waitFor(expert, (m) => m.type === "edit-rejected");
    expect(rej.issue).toBe("customer version wins");
    expect(rej.by).toBe("customer");

    const session = relay.store.get(sessionId);
    expect(session?.issue).toBe("customer version wins");
    expect(session?.issueEditedBy).toBe("customer");
  });

  it("expert edit with a current baseAt wins normally (last write wins)", async () => {
    const { agent, sessionId } = await registeredAgent();
    const expert = await rohitExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    await waitFor(agent, (m) => m.type === "expert-joined");

    // No prior customer edit, so the expert's edit is not stale.
    send(expert, { type: "edit-issue", sessionId, text: "expert first edit" });
    const toAgent = await waitFor(agent, (m) => m.type === "issue-updated");
    expect(toAgent.by).toBe("expert");
    expect(toAgent.issue).toBe("expert first edit");
    expect(relay.store.get(sessionId)?.issueEditedBy).toBe("expert");
  });

  it("hello-ok reports issueEditedAt and issueEditedBy after an edit", async () => {
    const { sessionId, customerToken } = await registeredAgent();
    const c1 = await connect("/customer");
    send(c1, { type: "hello", sessionId, token: customerToken });
    await waitFor(c1, (m) => m.type === "hello-ok");
    send(c1, { type: "edit-issue", text: "updated issue text" });
    await waitFor(c1, (m) => m.type === "issue-updated");

    const c2 = await connect("/customer");
    send(c2, { type: "hello", sessionId, token: customerToken });
    const hello = await waitFor(c2, (m) => m.type === "hello-ok");
    expect(hello.issue).toBe("updated issue text");
    expect(hello.issueEditedBy).toBe("customer");
    expect(typeof hello.issueEditedAt).toBe("number");
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
  it("keeps the request in the queue (offline) and returns the expert to idle when the agent disconnects", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    await waitFor(expert, (m) => m.type === "claimed");
    agent.close();
    // The expert's live session drops back to idle...
    const ended = await waitFor(expert, (m) => m.type === "session-ended");
    expect(ended.sessionId).toBe(sessionId);
    // ...but the request itself is NOT gone: it stays in the queue as offline,
    // released back to waiting so it can be re-claimed when the customer returns.
    const session = relay.store.get(sessionId);
    expect(session?.status).toBe("waiting");
    expect(session?.online).toBe(false);
    expect(session?.expertName).toBeUndefined();
    expect(relay.store.queue().map((s) => s.id)).toContain(sessionId);
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

  it("GET /api/roster returns the six public profiles and nothing secret", async () => {
    const res = await fetch(`${baseUrl}/api/roster`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(6);
    expect(body.map((e: any) => e.id)).toEqual([
      "rohit", "aakash", "senjal", "inigo", "hardik", "pulkit",
    ]);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("refuses path traversal outside the dashboard dir", async () => {
    const res = await fetch(`${baseUrl}/..%2f..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
  });
});

describe("durable inbox", () => {
  it("returns a resume token at registration", async () => {
    const { resumeToken } = await registeredAgent();
    expect(resumeToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it("keeps a waiting request in the queue (offline) when the agent disconnects", async () => {
    const { agent, sessionId } = await registeredAgent();
    agent.close();
    await pollUntil(() => relay.store.get(sessionId)?.online === false);
    const session = relay.store.get(sessionId);
    expect(session?.status).toBe("waiting");
    expect(relay.store.queue().map((s) => s.id)).toContain(sessionId);
  });

  it("marks the queue entry offline so experts can see it", async () => {
    const { agent, sessionId } = await registeredAgent();
    const { expert } = await authedExpert();
    agent.close();
    const update = await waitFor(
      expert,
      (m) => m.type === "queue" && m.sessions[0]?.online === false,
    );
    expect(update.sessions[0].sessionId).toBe(sessionId);
  });

  it("resumes an offline request with the right token and flips it back online", async () => {
    const { agent, sessionId, resumeToken } = await registeredAgent();
    agent.close();
    await pollUntil(() => relay.store.get(sessionId)?.online === false);

    const agent2 = await connect("/agent");
    send(agent2, { type: "resume", sessionId, resumeToken });
    const resumed = await nextMessage(agent2);
    expect(resumed.type).toBe("resumed");
    expect(resumed.sessionId).toBe(sessionId);
    expect(relay.store.get(sessionId)?.online).toBe(true);
  });

  it("rejects a resume with the wrong token and leaves the socket open to register", async () => {
    const { agent, sessionId } = await registeredAgent();
    agent.close();
    await pollUntil(() => relay.store.get(sessionId)?.online === false);

    const agent2 = await connect("/agent");
    send(agent2, { type: "resume", sessionId, resumeToken: "deadbeef" });
    const failed = await nextMessage(agent2);
    expect(failed.type).toBe("resume-failed");
    expect(relay.store.get(sessionId)?.online).toBe(false);
    // The socket is still usable — a fresh register works on it.
    send(agent2, {
      type: "register",
      customerName: "Fallback",
      projectDir: "~/x",
    });
    const reg = await nextMessage(agent2);
    expect(reg.type).toBe("registered");
  });

  it("refuses to claim an offline request until the customer reconnects", async () => {
    const { agent, sessionId } = await registeredAgent();
    agent.close();
    await pollUntil(() => relay.store.get(sessionId)?.online === false);

    const { expert } = await authedExpert();
    send(expert, { type: "claim", sessionId });
    const failed = await waitFor(expert, (m) => m.type === "claim-failed");
    expect(failed.reason).toMatch(/offline/i);
    expect(relay.store.get(sessionId)?.status).toBe("waiting");
  });

  it("expires a stale queued request via the max-age sweep", async () => {
    const short = await launch({ maxAgeMs: 50 });
    const agent = await connect("/agent", short.wsUrl);
    send(agent, { type: "register", customerName: "Stale", projectDir: "~/s" });
    const reg = await nextMessage(agent);
    await pollUntil(
      () => short.relay.store.get(reg.sessionId)?.status === "ended",
      4000,
    );
    expect(short.relay.store.queue().map((s) => s.id)).not.toContain(
      reg.sessionId,
    );
  });

  it("hydrates persisted requests into the queue as offline on boot", async () => {
    const persisted = {
      id: "sess_restored",
      customerName: "Restored Dana",
      projectDir: "~/restored",
      issue: "was mid-request when the relay restarted",
      status: "waiting" as const,
      online: false,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      permissions: { files: true, terminal: false, browser: false },
      activity: [],
      customerToken: "cust_tok",
      resumeTokenHash: "hash",
      chat: [],
    };
    const { relay: booted } = await launch({
      persistence: {
        save: async () => {},
        remove: async () => {},
        loadAll: async () => [persisted],
      },
    });
    await booted.hydrate();
    const restored = booted.store.get("sess_restored");
    expect(restored?.customerName).toBe("Restored Dana");
    expect(restored?.online).toBe(false);
    expect(booted.store.queue().map((s) => s.id)).toContain("sess_restored");
  });
});
