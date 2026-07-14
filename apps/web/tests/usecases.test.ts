import { describe, expect, it, vi } from "vitest";
import type { ExpertRequestPayload } from "@get-an-expert/core";
import { hashToken } from "../lib/id";
import { MemoryStore } from "../lib/store/memory";
import {
  createExpertRequest,
  deleteExpertRequest,
  DISCLOSURE_LINE,
  listExpertRequests,
  type AnalysisResult,
} from "../lib/usecases";
import type { ExpertRequestInput } from "../lib/schema";

const analysis: AnalysisResult = {
  diagnosis: "Symptom-patching loop on a timezone bug.",
  suggested_prompt: "Investigate the date formatting before changing code.",
  intro: "Took a look — that date mismatch is the tell.",
  expertise_area: "Next.js SSR & hydration",
  model: "claude-opus-4-8",
};

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
      textVersion: "2026-07-13.v1",
      at: "2026-07-13T12:00:00Z",
    },
    ...overrides,
  };
}

const BASE = "https://example.com";

describe("createExpertRequest", () => {
  it("stores an answered record and returns a formatted message", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      analyze: async () => analysis,
      input: input(),
      baseUrl: BASE,
    });

    expect(result.status).toBe("answered");
    expect(result.message).toContain(analysis.intro);
    expect(result.message).toContain(analysis.suggested_prompt);
    expect(result.message).toContain(DISCLOSURE_LINE);
    expect(result.message).toContain(result.deleteUrl);
    expect(result.deleteUrl).toContain(result.requestId);

    const stored = await store.get(result.requestId);
    expect(stored?.status).toBe("answered");
    expect(stored?.response?.suggestedPrompt).toBe(analysis.suggested_prompt);
    expect(stored?.consent.agreed).toBe(true);
  });

  it("re-redacts secrets server-side before storing", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      analyze: async () => analysis,
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

  it("passes the redacted payload (not the raw one) to the analyzer", async () => {
    const store = new MemoryStore();
    const analyze = vi.fn(async (_payload: ExpertRequestPayload) => analysis);
    await createExpertRequest({
      store,
      analyze,
      input: input({ goal: "key sk-ant-api03-supersecretsecret123456" }),
      baseUrl: BASE,
    });
    expect(analyze.mock.calls.at(0)?.[0]?.goal).not.toContain(
      "supersecretsecret",
    );
  });

  it("mints a chat token: hash stored, raw returned once, chat active", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      analyze: async () => analysis,
      input: input(),
      baseUrl: BASE,
    });
    expect(result.chatToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await store.get(result.requestId);
    expect(stored?.chatTokenHash).toBe(hashToken(result.chatToken));
    expect(stored?.chat).toMatchObject({ status: "active" });
    expect(JSON.stringify(stored)).not.toContain(result.chatToken);
  });

  it("still returns the chat token on the analysis-failure path", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      analyze: async () => {
        throw new Error("api down");
      },
      input: input(),
      baseUrl: BASE,
    });
    expect(result.chatToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await store.get(result.requestId);
    expect(stored?.chatTokenHash).toBe(hashToken(result.chatToken));
  });

  it("keeps the record and returns a fallback message when analysis fails", async () => {
    const store = new MemoryStore();
    const result = await createExpertRequest({
      store,
      analyze: async () => {
        throw new Error("api down");
      },
      input: input(),
      baseUrl: BASE,
    });

    expect(result.status).toBe("new");
    expect(result.message).toContain("snag");
    expect(result.message).toContain(result.requestId);
    const stored = await store.get(result.requestId);
    expect(stored?.status).toBe("new");
  });
});

describe("deleteExpertRequest", () => {
  it("deletes with the right token, refuses the wrong one", async () => {
    const store = new MemoryStore();
    const created = await createExpertRequest({
      store,
      analyze: async () => analysis,
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
      analyze: async () => analysis,
      input: input({ goal: "first" }),
      baseUrl: BASE,
      now: new Date("2026-07-13T10:00:00Z"),
    });
    await createExpertRequest({
      store,
      analyze: async () => analysis,
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
    expect(
      listed.some((r) => Object.hasOwn(r, "chatTokenHash")),
    ).toBe(false);
  });
});
