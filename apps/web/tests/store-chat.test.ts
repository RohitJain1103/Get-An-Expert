import { describe, expect, it } from "vitest";
import type { NewChatMessage } from "@get-an-expert/core";
import { MemoryStore } from "../lib/store/memory";
import type { StoredRequest } from "../lib/store/types";

const record = (id: string): StoredRequest => ({
  id,
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
});

const msg = (text: string): NewChatMessage => ({
  at: "2026-07-13T01:00:00.000Z",
  from: "user",
  kind: "message",
  text,
});

describe("store chat messages", () => {
  it("appends and lists with 1-based seq, oldest first", async () => {
    const store = new MemoryStore();
    await store.create(record("req_a"), 3600);
    expect(await store.appendMessage("req_a", msg("one"), 3600)).toBe(1);
    expect(await store.appendMessage("req_a", msg("two"), 3600)).toBe(2);
    const all = await store.listMessages("req_a", 0);
    expect(all.map((m) => [m.seq, m.text])).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
  });

  it("listMessages(afterSeq) returns only newer messages", async () => {
    const store = new MemoryStore();
    await store.create(record("req_a"), 3600);
    await store.appendMessage("req_a", msg("one"), 3600);
    await store.appendMessage("req_a", msg("two"), 3600);
    const newer = await store.listMessages("req_a", 1);
    expect(newer.map((m) => [m.seq, m.text])).toEqual([[2, "two"]]);
    expect(await store.listMessages("req_a", 2)).toEqual([]);
  });

  it("returns [] for unknown request", async () => {
    const store = new MemoryStore();
    expect(await store.listMessages("req_missing", 0)).toEqual([]);
  });

  it("delete removes the messages with the record", async () => {
    const store = new MemoryStore();
    await store.create(record("req_a"), 3600);
    await store.appendMessage("req_a", msg("one"), 3600);
    await store.delete("req_a");
    await store.create(record("req_a"), 3600);
    expect(await store.listMessages("req_a", 0)).toEqual([]);
  });

  it("put() preserves existing messages", async () => {
    const store = new MemoryStore();
    await store.create(record("req_a"), 3600);
    await store.appendMessage("req_a", msg("one"), 3600);
    await store.put({ ...record("req_a"), status: "escalated" }, 3600);
    const all = await store.listMessages("req_a", 0);
    expect(all.map((m) => m.text)).toEqual(["one"]);
  });

  it("messages are copied in and out (no shared mutable state)", async () => {
    const store = new MemoryStore();
    await store.create(record("req_a"), 3600);
    const original = msg("one");
    await store.appendMessage("req_a", original, 3600);
    original.text = "mutated";
    const [stored] = await store.listMessages("req_a", 0);
    expect(stored.text).toBe("one");
  });
});
