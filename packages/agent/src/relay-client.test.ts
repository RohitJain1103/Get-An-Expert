import { describe, expect, it, vi } from "vitest";
import { RelayClient, type WsLike } from "./relay-client";

/** A controllable in-process WebSocket: the test drives open/message/close. */
class FakeWs implements WsLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  #handlers = new Map<string, ((...a: any[]) => void)[]>();

  on(event: string, cb: (...a: any[]) => void): void {
    const list = this.#handlers.get(event) ?? [];
    list.push(cb);
    this.#handlers.set(event, list);
  }
  once(event: string, cb: (...a: any[]) => void): void {
    this.on(event, cb);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.#emit("close");
  }
  // ── test controls ──
  open(): void {
    this.readyState = 1; // OPEN
    this.#emit("open");
  }
  deliver(obj: unknown): void {
    this.#emit("message", JSON.stringify(obj));
  }
  #emit(event: string, ...args: any[]): void {
    for (const cb of [...(this.#handlers.get(event) ?? [])]) cb(...args);
  }
}

const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function makeClient() {
  const created: FakeWs[] = [];
  const client = new RelayClient("ws://relay.test", {
    wsFactory: () => {
      const ws = new FakeWs();
      created.push(ws);
      return ws;
    },
    baseDelayMs: 1,
    maxDelayMs: 2,
  });
  return { client, created };
}

describe("RelayClient.register", () => {
  it("resolves with the session id and captures the resume token", async () => {
    const { client, created } = makeClient();
    const p = client.register({ customerName: "A", projectDir: "~/a" });
    created[0].open();
    expect(created[0].sent[0]).toContain('"type":"register"');
    created[0].deliver({
      type: "registered",
      sessionId: "s1",
      customerToken: "c1",
      resumeToken: "r1",
    });
    expect(await p).toBe("s1");
    expect(client.sessionId).toBe("s1");
    expect(client.resumeToken).toBe("r1");
  });
});

describe("RelayClient reconnect + resume", () => {
  async function registered() {
    const ctx = makeClient();
    const p = ctx.client.register({ customerName: "A", projectDir: "~/a" });
    ctx.created[0].open();
    ctx.created[0].deliver({
      type: "registered",
      sessionId: "s1",
      customerToken: "c1",
      resumeToken: "r1",
    });
    await p;
    return ctx;
  }

  it("reconnects and sends a resume after an unexpected drop", async () => {
    const { client, created } = await registered();
    const onReconnecting = vi.fn();
    const onResumed = vi.fn();
    client.on({ onReconnecting, onResumed });

    created[0].close(); // unexpected
    expect(onReconnecting).toHaveBeenCalled();
    await wait();

    expect(created.length).toBe(2);
    created[1].open();
    const resumeMsg = JSON.parse(created[1].sent[0]);
    expect(resumeMsg).toMatchObject({
      type: "resume",
      sessionId: "s1",
      resumeToken: "r1",
    });
    created[1].deliver({ type: "resumed", status: "waiting" });
    expect(onResumed).toHaveBeenCalled();
  });

  it("stops reconnecting and reports failure when the relay rejects the resume", async () => {
    const { client, created } = await registered();
    const onResumeFailed = vi.fn();
    client.on({ onResumeFailed });

    created[0].close();
    await wait();
    created[1].open();
    created[1].deliver({ type: "resume-failed", reason: "expired" });
    expect(onResumeFailed).toHaveBeenCalled();

    // A subsequent drop must NOT spawn another reconnect (session is gone).
    created[1].close();
    await wait();
    expect(created.length).toBe(2);
  });

  it("does not reconnect after an intentional close", async () => {
    const { client, created } = await registered();
    const onClose = vi.fn();
    client.on({ onClose });
    client.close();
    await wait();
    expect(created.length).toBe(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not reconnect after the relay ends the session", async () => {
    const { client, created } = await registered();
    const onSessionEnded = vi.fn();
    client.on({ onSessionEnded });
    created[0].deliver({ type: "session-ended", reason: "expert finished" });
    expect(onSessionEnded).toHaveBeenCalled();
    created[0].close();
    await wait();
    expect(created.length).toBe(1);
  });
});

describe("RelayClient.resume (process-restart path)", () => {
  it("connects, sends resume, and resolves on resumed", async () => {
    const { client, created } = makeClient();
    const p = client.resume("s9", "tok9");
    created[0].open();
    expect(JSON.parse(created[0].sent[0])).toMatchObject({
      type: "resume",
      sessionId: "s9",
      resumeToken: "tok9",
    });
    created[0].deliver({ type: "resumed", status: "waiting" });
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects when the relay rejects the resume", async () => {
    const { client, created } = makeClient();
    const p = client.resume("s9", "bad");
    created[0].open();
    created[0].deliver({ type: "resume-failed", reason: "unknown session" });
    await expect(p).rejects.toThrow(/unknown session/);
  });
});
