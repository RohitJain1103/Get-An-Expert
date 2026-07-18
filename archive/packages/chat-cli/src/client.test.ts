import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatClient } from "./client";

const client = () =>
  new ChatClient({
    baseUrl: "https://example.test",
    requestId: "req_a",
    token: "tok",
  });

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatClient.fetchMessages", () => {
  it("returns messages and chat status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          messages: [
            {
              seq: 1,
              at: "2026-07-13T00:00:00.000Z",
              from: "expert",
              authorName: "Priya",
              kind: "message",
              text: "hi",
            },
          ],
          chat: { status: "active", expertName: "Priya" },
        },
        error: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().fetchMessages(0);
    expect(result).toEqual({
      ok: true,
      messages: [expect.objectContaining({ seq: 1, text: "hi" })],
      chatStatus: "active",
      expertName: "Priya",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "https://example.test/api/v1/requests/req_a/messages?after=0",
    );
    expect((init.headers as Record<string, string>)["x-chat-token"]).toBe(
      "tok",
    );
  });

  it("maps network failure to a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const result = await client().fetchMessages(0);
    expect(result.ok).toBe(false);
  });

  it("surfaces the server error message on failure envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          success: false,
          data: null,
          error: "Missing or invalid chat credentials.",
        }),
      ),
    );
    const result = await client().fetchMessages(0);
    expect(result).toEqual({
      ok: false,
      error: "Missing or invalid chat credentials.",
    });
  });
});

describe("ChatClient.postMessage", () => {
  it("redacts secrets locally before sending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: { seq: 2 }, error: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().postMessage(
      "key: sk-ant-api03-abcdefghijklmnopqrstuvwx",
    );
    expect(result).toEqual({ ok: true, seq: 2 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain("sk-ant-");
    expect(String(init.body)).toContain("[REDACTED:anthropic-api-key]");
  });

  it("signals the hard stop on 410", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(410, {
          success: false,
          data: null,
          error: "This chat has ended.",
        }),
      ),
    );
    const result = await client().postMessage("hello");
    expect(result).toEqual({
      ok: false,
      ended: true,
      error: "This chat has ended.",
    });
  });
});

describe("ChatClient.endChat", () => {
  it("posts to the end route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { ended: true },
        error: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().endChat()).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://example.test/api/v1/requests/req_a/end",
    );
  });
});
