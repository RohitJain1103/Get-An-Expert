import { describe, expect, it } from "vitest";
import {
  endChatSession,
  listChatMessages,
  postChatMessage,
  verifyChatToken,
} from "../lib/chat";
import { hashToken } from "../lib/id";
import { MemoryStore } from "../lib/store/memory";
import type { StoredRequest } from "../lib/store/types";

const NOW = new Date("2026-07-13T02:00:00.000Z");

function makeRecord(overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    id: "req_a",
    createdAt: "2026-07-13T00:00:00.000Z",
    status: "new",
    payload: {
      tool: "claude-code",
      goal: "g",
      whatWasTried: [],
      errorMessages: [],
      conversationSummary: "",
      techStack: [],
      expertiseArea: "x",
    },
    serverRedactions: [],
    consent: { agreed: true, textVersion: "v", at: "2026-07-13T00:00:00.000Z" },
    deleteTokenHash: "hash",
    chatTokenHash: hashToken("secret-token"),
    chat: { status: "active", startedAt: "2026-07-13T00:00:00.000Z" },
    ...overrides,
  };
}

async function seeded(overrides: Partial<StoredRequest> = {}) {
  const store = new MemoryStore();
  const record = makeRecord(overrides);
  await store.create(record, 3600);
  return { store, record };
}

describe("verifyChatToken", () => {
  it("accepts the right token and rejects wrong/missing ones", () => {
    const record = makeRecord();
    expect(verifyChatToken(record, "secret-token")).toBe(true);
    expect(verifyChatToken(record, "wrong")).toBe(false);
    expect(verifyChatToken(record, "")).toBe(false);
    expect(verifyChatToken(makeRecord({ chatTokenHash: undefined }), "x")).toBe(
      false,
    );
  });
});

describe("postChatMessage", () => {
  it("appends a user message and returns its seq", async () => {
    const { store, record } = await seeded();
    const result = await postChatMessage({
      store,
      record,
      from: "user",
      text: "hello",
      now: NOW,
    });
    expect(result).toEqual({ outcome: "ok", seq: 1 });
    const { messages } = await listChatMessages(store, "req_a", 0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      from: "user",
      kind: "message",
      text: "hello",
      at: NOW.toISOString(),
    });
  });

  it("redacts secrets server-side before storing", async () => {
    const { store, record } = await seeded();
    await postChatMessage({
      store,
      record,
      from: "user",
      text: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwx",
      now: NOW,
    });
    const { messages } = await listChatMessages(store, "req_a", 0);
    expect(messages[0]?.text).not.toContain("sk-ant-");
    expect(messages[0]?.text).toContain("[REDACTED:anthropic-api-key]");
  });

  it("first expert message inserts a join notice and records the join", async () => {
    const { store, record } = await seeded();
    const result = await postChatMessage({
      store,
      record,
      from: "expert",
      authorName: "Priya",
      text: "hi, I'm here",
      now: NOW,
    });
    expect(result.outcome).toBe("ok");
    const { messages, chat } = await listChatMessages(store, "req_a", 0);
    expect(messages.map((m) => [m.kind, m.from])).toEqual([
      ["system", "expert"],
      ["message", "expert"],
    ]);
    expect(messages[0]?.text).toBe("Priya joined the chat");
    expect(chat?.expertJoinedAt).toBe(NOW.toISOString());
    expect(chat?.expertName).toBe("Priya");
  });

  it("second expert message does NOT repeat the join notice", async () => {
    const { store, record } = await seeded();
    await postChatMessage({
      store,
      record,
      from: "expert",
      authorName: "Priya",
      text: "one",
      now: NOW,
    });
    const fresh = await store.get("req_a");
    expect(fresh).not.toBeNull();
    await postChatMessage({
      store,
      record: fresh as StoredRequest,
      from: "expert",
      authorName: "Priya",
      text: "two",
      now: NOW,
    });
    const { messages } = await listChatMessages(store, "req_a", 0);
    expect(messages.filter((m) => m.kind === "system")).toHaveLength(1);
  });

  it("refuses to post once the chat has ended (hard stop)", async () => {
    const { store, record } = await seeded({
      chat: {
        status: "ended",
        startedAt: "2026-07-13T00:00:00.000Z",
        endedAt: "2026-07-13T01:00:00.000Z",
        endedBy: "user",
      },
    });
    const result = await postChatMessage({
      store,
      record,
      from: "user",
      text: "too late",
      now: NOW,
    });
    expect(result).toEqual({ outcome: "ended" });
    expect((await listChatMessages(store, "req_a", 0)).messages).toEqual([]);
  });

  it("refuses when the record has no chat state (pre-feature record)", async () => {
    const { store, record } = await seeded({ chat: undefined });
    const result = await postChatMessage({
      store,
      record,
      from: "user",
      text: "hi",
      now: NOW,
    });
    expect(result).toEqual({ outcome: "ended" });
  });
});

describe("endChatSession", () => {
  it("marks the chat ended with who ended it, and appends a system notice", async () => {
    const { store, record } = await seeded();
    const result = await endChatSession({
      store,
      record,
      by: "user",
      now: NOW,
    });
    expect(result).toBe("ended");
    const stored = await store.get("req_a");
    expect(stored?.chat).toMatchObject({
      status: "ended",
      endedAt: NOW.toISOString(),
      endedBy: "user",
    });
    const { messages } = await listChatMessages(store, "req_a", 0);
    expect(messages.at(-1)).toMatchObject({
      kind: "system",
      text: "Chat ended. Nothing is shared anymore.",
    });
  });

  it("is idempotent — ending twice stays ended by the first ender", async () => {
    const { store, record } = await seeded();
    await endChatSession({ store, record, by: "expert", now: NOW });
    const fresh = await store.get("req_a");
    expect(fresh).not.toBeNull();
    const result = await endChatSession({
      store,
      record: fresh as StoredRequest,
      by: "user",
      now: NOW,
    });
    expect(result).toBe("already_ended");
    expect((await store.get("req_a"))?.chat?.endedBy).toBe("expert");
  });
});

describe("listChatMessages", () => {
  it("returns chat state alongside messages", async () => {
    const { store } = await seeded();
    const { chat, messages } = await listChatMessages(store, "req_a", 0);
    expect(chat?.status).toBe("active");
    expect(messages).toEqual([]);
  });
});
