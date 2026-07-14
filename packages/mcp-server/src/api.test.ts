import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRedactedPayload, REQUEST_TIMEOUT_MS, submitExpertRequest } from "./api";

/**
 * Web route's `maxDuration` (apps/web/app/api/v1/requests/route.ts). Not
 * imported directly — mcp-server and apps/web are separate deployables —
 * but the two MUST stay in this relationship or completed analyses get
 * orphaned server-side while the customer sees a false "timed out" error.
 */
const SERVER_MAX_DURATION_MS = 300_000;

const input = {
  tool: "claude-code",
  goal: "deploy the app",
  whatWasTried: ["ran deploy with API_KEY=supersecretvalue99 in env"],
  errorMessages: ["auth failed for key sk-ant-api03-verysecretkey12345678"],
  conversationSummary: "stuck on deploy auth",
  techStack: ["Next.js"],
  expertiseArea: "Vercel deployment",
  messagesStuckCount: 11,
};

describe("buildRedactedPayload", () => {
  it("redacts secrets locally and reports what was removed", () => {
    const { payload, clientRedactions } = buildRedactedPayload(input);
    expect(payload.whatWasTried[0]).not.toContain("supersecretvalue99");
    expect(payload.errorMessages[0]).not.toContain("verysecretkey");
    expect(clientRedactions.map((r) => r.type)).toContain("anthropic-api-key");
    // input untouched (immutability)
    expect(input.errorMessages[0]).toContain("verysecretkey");
  });
});

describe("REQUEST_TIMEOUT_MS", () => {
  it("stays >= the server's analysis budget so completed answers are never orphaned", () => {
    // Regression guard: this was 150_000 (< server's 300_000 budget), which
    // let the client abort mid-analysis while the server kept working,
    // stored a real answer, and the customer never saw it.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(SERVER_MAX_DURATION_MS);
  });
});

describe("submitExpertRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the redacted payload with consent and returns the message", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { message: "Here's your prompt." },
          error: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitExpertRequest(input, new Date("2026-07-13T12:00:00Z"));
    expect(result).toEqual({ ok: true, message: "Here's your prompt." });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/api/v1/requests");
    const sent = JSON.parse(String(init.body));
    expect(sent.consent).toEqual({
      agreed: true,
      textVersion: expect.any(String),
      at: "2026-07-13T12:00:00.000Z",
    });
    expect(sent.errorMessages[0]).not.toContain("verysecretkey");
    expect(sent.installId).toBeTruthy();
    expect(sent.clientRedactions.length).toBeGreaterThan(0);
  });

  it("returns an actionable error on rate limiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, data: null, error: "Slow down." }),
          { status: 429 },
        ),
      ),
    );
    const result = await submitExpertRequest(input, new Date());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Slow down.");
  });

  it("returns an actionable error when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await submitExpertRequest(input, new Date());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("could not be reached");
  });
});
