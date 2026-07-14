import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRedactedPayload, submitExpertRequest } from "./api";

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

describe("thread messaging", () => {
  let dir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    dir = mkdtempSync(join(tmpdir(), "gae-api-"));
    process.env.GET_AN_EXPERT_STATE_DIR = dir;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.GET_AN_EXPERT_STATE_DIR;
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  });

  const thread = {
    requestId: "req_abc",
    threadToken: "tok_secret",
    apiBaseUrl: "https://gae.example",
    expertiseArea: "Next.js",
    lastSeenSeq: 0,
    createdAt: new Date().toISOString(),
  };

  it("submitExpertRequest persists the thread credentials it receives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              message: "thread open",
              requestId: "req_new1",
              threadToken: "tok_new1",
            },
            error: null,
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await submitExpertRequest(input, new Date());
    expect(result.ok).toBe(true);

    const { loadActiveThread } = await import("./thread");
    const { apiBaseUrl } = await import("./config");
    expect(loadActiveThread(apiBaseUrl())).toMatchObject({
      requestId: "req_new1",
      threadToken: "tok_new1",
      expertiseArea: "Vercel deployment",
      lastSeenSeq: 0,
    });
  });

  it("postThreadMessage sends the redacted message with the bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { seq: 3, status: "live" }, error: null }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { postThreadMessage } = await import("./api");
    const result = await postThreadMessage(
      thread,
      "key is sk-ant-api03-verysecretkey12345678",
      { whatWasTried: ["set API_KEY=supersecretvalue99"], errorMessages: [] },
    );
    expect(result).toEqual({ ok: true, value: { seq: 3, status: "live" } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gae.example/api/v1/requests/req_abc/messages");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok_secret",
    );
    const sent = JSON.parse(String(init.body));
    expect(sent.text).not.toContain("verysecretkey");
    expect(sent.progress.whatWasTried[0]).not.toContain("supersecretvalue99");
  });

  it("fetchThreadUpdates asks after lastSeenSeq and clears a gone thread", async () => {
    const { saveActiveThread, loadActiveThread } = await import("./thread");
    saveActiveThread(thread);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, data: null, error: "gone" }),
        { status: 404 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchThreadUpdates } = await import("./api");
    const result = await fetchThreadUpdates({ ...thread, lastSeenSeq: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gone).toBe(true);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "https://gae.example/api/v1/requests/req_abc/messages?after=7",
    );
    expect(loadActiveThread(thread.apiBaseUrl)).toBeNull();
  });
});
