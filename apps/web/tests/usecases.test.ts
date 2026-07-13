import { describe, expect, it } from "vitest";
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
    expertiseArea: "Next.js SSR & hydration",
    consent: {
      agreed: true,
      textVersion: "2026-07-13.v2",
      at: "2026-07-13T12:00:00Z",
    },
    ...overrides,
  };
}

const BASE = "https://example.com";

describe("createExpertRequest", () => {
  it("stores the request and returns a received confirmation", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      input: input(),
      baseUrl: BASE,
    });

    expect(result.status).toBe("new");
    expect(result.message).toContain("Request received");
    expect(result.message).toContain("human expert");
    expect(result.message).toContain("Next.js SSR & hydration");
    expect(result.message).toContain(result.requestId);
    expect(result.message).toContain(RETENTION_LINE);
    expect(result.message).toContain(result.deleteUrl);
    expect(result.deleteUrl).toContain(result.requestId);

    const stored = await store.get(result.requestId);
    expect(stored?.status).toBe("new");
    expect(stored?.response).toBeUndefined();
    expect(stored?.consent.agreed).toBe(true);
  });

  it("never promises an AI-generated answer", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      input: input(),
      baseUrl: BASE,
    });
    expect(result.message).not.toMatch(/\bAI\b/i);
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
  it("lists newest first and never exposes the delete token hash", async () => {
    const store = new MemoryStore();
    await createExpertRequest({
      store,
      input: input({ goal: "first" }),
      baseUrl: BASE,
      now: new Date("2026-07-13T10:00:00Z"),
    });
    await createExpertRequest({
      store,
      input: input({ goal: "second" }),
      baseUrl: BASE,
      now: new Date("2026-07-13T11:00:00Z"),
    });

    const listed = await listExpertRequests(store, 10);
    expect(listed).toHaveLength(2);
    expect(listed[0].payload.goal).toBe("second");
    expect(
      listed.some((r) => Object.hasOwn(r, "deleteTokenHash")),
    ).toBe(false);
  });
});
