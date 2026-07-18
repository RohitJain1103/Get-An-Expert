import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRelayFlag,
  writeRelayFlag,
  type RelayFlag,
} from "@get-an-expert/core/relay";
import {
  lastAssistantText,
  outboxDir,
  runRelay,
  runSend,
} from "./relay";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-relayrun-"));
  process.env.GET_AN_EXPERT_HOME = dir;
});

afterEach(() => {
  delete process.env.GET_AN_EXPERT_HOME;
  vi.unstubAllGlobals();
});

const flag: RelayFlag = {
  requestId: "req_a",
  chatToken: "tok",
  apiBaseUrl: "https://example.test",
};

const NOW = new Date("2026-07-14T02:00:00.000Z");

function readSpool(spoolPath: string) {
  return JSON.parse(readFileSync(spoolPath, "utf8")) as {
    url: string;
    token: string;
    body: { type: string; text: string };
  };
}

describe("runRelay", () => {
  it("is a silent no-op when no relay flag exists", () => {
    const result = runRelay(
      "claude-code",
      "prompt",
      JSON.stringify({ prompt: "hi" }),
      NOW,
    );
    expect(result).toEqual({ stdout: null, spoolPath: null });
  });

  it("spools a redacted, typed event and reports 🟢 LIVE for prompts", () => {
    writeRelayFlag({ ...flag, expertName: "Priya" });
    const result = runRelay(
      "claude-code",
      "prompt",
      JSON.stringify({ prompt: "key sk-ant-api03-abcdefghijklmnopqrstuvwx" }),
      NOW,
    );
    expect(result.stdout).toContain("🟢 LIVE");
    expect(result.stdout).toContain("Priya");
    expect(result.spoolPath).not.toBeNull();
    const spool = readSpool(result.spoolPath as string);
    expect(spool.url).toBe(
      "https://example.test/api/v1/requests/req_a/events",
    );
    expect(spool.token).toBe("tok");
    expect(spool.body.type).toBe("prompt");
    expect(spool.body.text).toContain("[REDACTED:anthropic-api-key]");
    expect(spool.body.text).not.toContain("sk-ant-");
  });

  it("honors /pause on the very next event but keeps the banner", () => {
    writeRelayFlag({ ...flag, pausedUntil: "2026-07-14T03:00:00.000Z" });
    const result = runRelay(
      "claude-code",
      "prompt",
      JSON.stringify({ prompt: "hi" }),
      NOW,
    );
    expect(result.spoolPath).toBeNull();
    expect(result.stdout).toContain("🟢 LIVE");
    expect(existsSync(join(dir, "outbox"))).toBe(false);
  });

  it("resumes after pausedUntil passes", () => {
    writeRelayFlag({ ...flag, pausedUntil: "2026-07-14T01:00:00.000Z" });
    const result = runRelay(
      "cursor",
      "afterShellExecution",
      JSON.stringify({ command: "ls", output: "a b" }),
      NOW,
    );
    expect(result.spoolPath).not.toBeNull();
  });

  it("stays silent on unparseable stdin and unknown events", () => {
    writeRelayFlag(flag);
    expect(
      runRelay("cursor", "afterShellExecution", "not json", NOW).spoolPath,
    ).toBeNull();
    expect(
      runRelay("cursor", "sessionEnd", JSON.stringify({}), NOW).spoolPath,
    ).toBeNull();
  });
});

describe("runSend", () => {
  function spoolFile(): string {
    const path = join(dir, "spool.json");
    writeFileSync(
      path,
      JSON.stringify({
        url: "https://example.test/api/v1/requests/req_a/events",
        token: "tok",
        body: { type: "prompt", text: "hi" },
      }),
    );
    return path;
  }

  it("POSTs the spooled event with the chat token and deletes the spool", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const path = spoolFile();
    await runSend(path, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/api/v1/requests/req_a/events");
    expect((init.headers as Record<string, string>)["x-chat-token"]).toBe(
      "tok",
    );
    expect(() => readFileSync(path)).toThrow();
  });

  it("clears the relay flag on 410 (expert-side hard stop self-heals)", async () => {
    writeRelayFlag(flag);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 410 }));
    await runSend(spoolFile(), fetchMock as unknown as typeof fetch);
    expect(readRelayFlag()).toBeNull();
  });

  it("keeps the flag on transient failure and stays silent", async () => {
    writeRelayFlag(flag);
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    await runSend(spoolFile(), fetchMock as unknown as typeof fetch);
    expect(readRelayFlag()).not.toBeNull();
  });
});

describe("lastAssistantText", () => {
  it("extracts the last assistant text blocks", () => {
    const transcript = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "first answer" }] },
      }),
      JSON.stringify({ type: "user", message: { content: "next q" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash" },
            { type: "text", text: "final answer" },
          ],
        },
      }),
    ].join("\n");
    expect(lastAssistantText(transcript)).toBe("final answer");
  });

  it("returns null when no assistant text exists", () => {
    expect(lastAssistantText("")).toBeNull();
    expect(
      lastAssistantText(JSON.stringify({ type: "user", message: {} })),
    ).toBeNull();
  });
});

describe("outboxDir", () => {
  it("lives under the expert home dir", () => {
    expect(outboxDir()).toBe(join(dir, "outbox"));
  });
});
