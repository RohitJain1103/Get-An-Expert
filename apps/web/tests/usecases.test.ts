import { describe, expect, it } from "vitest";
import { hashToken } from "../lib/id";
import { MemoryStore } from "../lib/store/memory";
import {
  createExpertRequest,
  deleteExpertRequest,
  listExpertRequests,
  RETENTION_LINE,
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
    expertiseArea: "Next.js",
    consent: {
      agreed: true,
      textVersion: "2026-07-14.v2",
      at: "2026-07-14T12:00:00Z",
    },
    ...overrides,
  };
}

const BASE = "https://example.com";

describe("createExpertRequest", () => {
  it("stores a new chat-capable record and returns a received message", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      input: input(),
      baseUrl: BASE,
    });

    expect(result.status).toBe("new");
    expect(result.message).toContain("Request received");
    expect(result.message).toContain(RETENTION_LINE);
    expect(result.message).toContain(result.deleteUrl);
    expect(result.deleteUrl).toContain(result.requestId);

    const stored = await store.get(result.requestId);
    expect(stored?.status).toBe("new");
    expect(stored?.chat).toMatchObject({ status: "active" });
    expect(stored?.consent.agreed).toBe(true);
  });

  it("re-redacts secrets server-side before storing", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      input: input({
        goal: "deploy with key sk-ant-api03-supersecretsecret123456",
      }),
      baseUrl: BASE,
    });

    const stored = await store.get(result.requestId);
    expect(stored?.payload.goal).not.toContain("supersecretsecret");
    expect(stored?.serverRedactions).toEqual([
      { type: "anthropic-api-key", count: 1 },
    ]);
  });

  it("mints both tokens: hashes stored, raw returned once", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      input: input(),
      baseUrl: BASE,
    });
    expect(result.chatToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.deleteToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await store.get(result.requestId);
    expect(stored?.chatTokenHash).toBe(hashToken(result.chatToken));
    expect(stored?.deleteTokenHash).toBe(hashToken(result.deleteToken));
    expect(JSON.stringify(stored)).not.toContain(result.chatToken);
    expect(JSON.stringify(stored)).not.toContain(result.deleteToken);
  });
});

describe("deleteExpertRequest", () => {
  it("deletes with the right token, refuses the wrong one", async () => {
    const store = new MemoryStore();
    const created = await createExpertRequest({
      store,
      input: input(),
      baseUrl: BASE,
    });

    expect(
      await deleteExpertRequest(store, created.requestId, "wrong-token"),
    ).toBe("forbidden");
    expect(
      await deleteExpertRequest(store, created.requestId, created.deleteToken),
    ).toBe("deleted");
    expect(await store.get(created.requestId)).toBeNull();
    expect(
      await deleteExpertRequest(store, created.requestId, created.deleteToken),
    ).toBe("not_found");
  });
});

describe("listExpertRequests", () => {
  it("lists newest first and never exposes either token hash", async () => {
    const store = new MemoryStore();
    await createExpertRequest({
      store,
      input: input({ goal: "first" }),
      baseUrl: BASE,
      now: new Date("2026-07-14T10:00:00Z"),
    });
    await createExpertRequest({
      store,
      input: input({ goal: "second" }),
      baseUrl: BASE,
      now: new Date("2026-07-14T11:00:00Z"),
    });

    const listed = await listExpertRequests(store, 10);
    expect(listed).toHaveLength(2);
    expect(listed[0].payload.goal).toBe("second");
    expect(listed.some((r) => Object.hasOwn(r, "deleteTokenHash"))).toBe(false);
    expect(listed.some((r) => Object.hasOwn(r, "chatTokenHash"))).toBe(false);
  });
});
