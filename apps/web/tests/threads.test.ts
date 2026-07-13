import { describe, expect, it } from "vitest";
import { MemoryStore } from "../lib/store/memory";
import {
  claimThread,
  createExpertRequest,
  deleteExpertRequest,
  listThreadMessages,
  markThreadSolved,
  postExpertMessage,
  postUserMessage,
} from "../lib/usecases";
import type { ExpertRequestInput } from "../lib/schema";

function input(overrides: Partial<ExpertRequestInput> = {}): ExpertRequestInput {
  return {
    tool: "claude-code",
    goal: "fix hydration error",
    whatWasTried: ["suppressHydrationWarning"],
    errorMessages: ["Hydration failed"],
    conversationSummary: "16 messages of failed fixes",
    techStack: ["Next.js"],
    expertiseArea: "Next.js SSR & hydration",
    consent: {
      agreed: true,
      textVersion: "2026-07-13.v3",
      at: "2026-07-13T12:00:00Z",
    },
    ...overrides,
  };
}

const BASE = "https://example.com";

async function openThread(store: MemoryStore) {
  return createExpertRequest({ store, input: input(), baseUrl: BASE });
}

describe("postUserMessage", () => {
  it("rejects unknown ids and wrong tokens", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);

    const missing = await postUserMessage({
      store,
      id: "req_nope",
      token: created.threadToken,
      text: "hello",
    });
    expect(missing).toEqual({ ok: false, reason: "not_found" });

    const forbidden = await postUserMessage({
      store,
      id: created.requestId,
      token: "wrong-token",
      text: "hello",
    });
    expect(forbidden).toEqual({ ok: false, reason: "forbidden" });
    expect(await store.listMessages(created.requestId, 0)).toHaveLength(0);
  });

  it("appends the message, and a progress activity when provided", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);

    const first = await postUserMessage({
      store,
      id: created.requestId,
      token: created.threadToken,
      text: "still not fixed",
      progress: {
        whatWasTried: ["applied the timezone fix"],
        errorMessages: ["Hydration failed again"],
      },
    });
    expect(first).toMatchObject({ ok: true, seq: 1 });

    const messages = await store.listMessages(created.requestId, 0);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      seq: 1,
      from: "user",
      kind: "message",
      text: "still not fixed",
    });
    expect(messages[1]).toMatchObject({ seq: 2, from: "user", kind: "activity" });
    expect(messages[1].text).toContain("applied the timezone fix");
    expect(messages[1].text).toContain("Hydration failed again");

    const record = await store.get(created.requestId);
    expect(record?.lastActivityAt).toBe(messages[0].at);
  });

  it("redacts secrets in message text and progress", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);

    await postUserMessage({
      store,
      id: created.requestId,
      token: created.threadToken,
      text: "my key is sk-ant-api03-supersecretsecret123456 btw",
      progress: {
        whatWasTried: ["exported API_KEY=sk-ant-api03-supersecretsecret123456"],
        errorMessages: [],
      },
    });

    const messages = await store.listMessages(created.requestId, 0);
    for (const message of messages) {
      expect(message.text).not.toContain("supersecretsecret");
    }
  });

  it("reopens a solved thread", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);
    await markThreadSolved(store, created.requestId);
    expect((await store.get(created.requestId))?.status).toBe("solved");

    const result = await postUserMessage({
      store,
      id: created.requestId,
      token: created.threadToken,
      text: "it broke again",
    });
    expect(result).toMatchObject({ ok: true, status: "live" });
    expect((await store.get(created.requestId))?.status).toBe("live");
  });
});

describe("listThreadMessages", () => {
  it("authenticates and filters by afterSeq", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);
    await postUserMessage({
      store,
      id: created.requestId,
      token: created.threadToken,
      text: "first",
    });
    await postExpertMessage(store, created.requestId, "expert reply");

    const denied = await listThreadMessages({
      store,
      id: created.requestId,
      token: "wrong",
      afterSeq: 0,
    });
    expect(denied).toEqual({ ok: false, reason: "forbidden" });

    const all = await listThreadMessages({
      store,
      id: created.requestId,
      token: created.threadToken,
      afterSeq: 0,
    });
    expect(all.ok && all.messages).toHaveLength(2);

    const later = await listThreadMessages({
      store,
      id: created.requestId,
      token: created.threadToken,
      afterSeq: 1,
    });
    expect(later.ok && later.messages).toEqual([
      expect.objectContaining({ seq: 2, from: "expert", text: "expert reply" }),
    ]);
    expect(later.ok && later.status).toBe("live");
  });
});

describe("expert-side thread operations", () => {
  it("claim sets the expert name once and goes live", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);

    expect(await claimThread(store, created.requestId, "Priya S.")).toBe(true);
    let record = await store.get(created.requestId);
    expect(record?.status).toBe("live");
    expect(record?.expertName).toBe("Priya S.");

    await claimThread(store, created.requestId, "Someone Else");
    record = await store.get(created.requestId);
    expect(record?.expertName).toBe("Priya S.");

    const messages = await store.listMessages(created.requestId, 0);
    expect(messages[0]).toMatchObject({
      from: "expert",
      kind: "activity",
      text: "Priya S. joined the thread",
    });
  });

  it("expert replies are redacted and set the thread live", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);

    const result = await postExpertMessage(
      store,
      created.requestId,
      "try key sk-ant-api03-supersecretsecret123456",
    );
    expect(result.ok).toBe(true);
    const messages = await store.listMessages(created.requestId, 0);
    expect(messages[0].text).not.toContain("supersecretsecret");
    expect((await store.get(created.requestId))?.status).toBe("live");
  });

  it("solve appends an activity and flips status", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);
    expect(await markThreadSolved(store, created.requestId)).toBe(true);
    expect((await store.get(created.requestId))?.status).toBe("solved");
    const messages = await store.listMessages(created.requestId, 0);
    expect(messages.at(-1)?.text).toContain("solved");
  });
});

describe("deletion", () => {
  it("removes the thread messages with the record", async () => {
    const store = new MemoryStore();
    const created = await openThread(store);
    await postUserMessage({
      store,
      id: created.requestId,
      token: created.threadToken,
      text: "hello",
    });

    expect(
      await deleteExpertRequest(store, created.requestId, created.deleteToken),
    ).toBe("deleted");
    expect(await store.listMessages(created.requestId, 0)).toHaveLength(0);
  });
});
