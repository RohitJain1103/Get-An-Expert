import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "./agent-session";
import { buildChatUrl } from "./chat-url";
import type { ActivityEntry, BrowserController } from "./types";

/** No real browser needed for these tests — and none should ever launch. */
const fakeBrowser: BrowserController = {
  screenshot: async () => ({ ok: false, port: 3000, note: "test stub" }),
  console: async () => ({ port: 3000, entries: [] }),
  close: async () => {},
};

let projectDir: string;

beforeEach(() => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-session-")));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function makeSession(onActivity?: (entry: ActivityEntry) => void): AgentSession {
  return new AgentSession({
    relayUrl: "ws://127.0.0.1:1",
    projectDir,
    customerName: "Jordan Lee",
    browser: fakeBrowser,
    onActivity,
  });
}

describe("AgentSession.writeContext", () => {
  it("writes CONTEXT.md under .get-an-expert and logs the activity", async () => {
    const entries: ActivityEntry[] = [];
    const session = makeSession((entry) => entries.push(entry));

    await session.writeContext("# Get An Expert — session context\n");

    const path = join(projectDir, ".get-an-expert", "CONTEXT.md");
    expect(readFileSync(path, "utf8")).toContain("session context");
    const entry = session.activity().find((e) => e.kind === "context");
    expect(entry?.summary).toBe("Session context written: .get-an-expert/CONTEXT.md");
    expect(entries.some((e) => e.kind === "context")).toBe(true);

    await session.end();
  });
});

describe("AgentSession.end", () => {
  it("removes the .get-an-expert directory on end", async () => {
    const session = makeSession();
    await session.writeContext("context");
    const dir = join(projectDir, ".get-an-expert");
    expect(existsSync(dir)).toBe(true);

    await session.end();
    expect(existsSync(dir)).toBe(false);
  });

  it("ends cleanly when no context was ever written", async () => {
    const session = makeSession();
    await session.end();
    expect(existsSync(join(projectDir, ".get-an-expert"))).toBe(false);
    expect(session.state).toBe("ended");
  });
});

describe("AgentSession.chatUrl", () => {
  it("is undefined before registration (no session id or token)", () => {
    const session = makeSession();
    expect(session.chatUrl).toBeUndefined();
    expect(session.status().chatUrl).toBeUndefined();
  });
});

describe("buildChatUrl", () => {
  it("converts ws:// to http://", () => {
    expect(buildChatUrl("ws://127.0.0.1:8787", "abc123", "deadbeef")).toBe(
      "http://127.0.0.1:8787/chat#abc123.deadbeef",
    );
  });

  it("converts wss:// to https://", () => {
    expect(buildChatUrl("wss://relay.example.com", "abc123", "deadbeef")).toBe(
      "https://relay.example.com/chat#abc123.deadbeef",
    );
  });

  it("strips trailing slashes before appending the path", () => {
    expect(buildChatUrl("wss://relay.example.com///", "abc", "def")).toBe(
      "https://relay.example.com/chat#abc.def",
    );
  });

  it("leaves an http(s) relay URL scheme untouched", () => {
    expect(buildChatUrl("https://relay.example.com/", "abc", "def")).toBe(
      "https://relay.example.com/chat#abc.def",
    );
  });
});
