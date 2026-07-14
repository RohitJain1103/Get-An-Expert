import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadMessage } from "@get-an-expert/core";
import {
  clearActiveThread,
  formatThreadMessages,
  loadActiveThread,
  markSeen,
  saveActiveThread,
  type ActiveThread,
} from "./thread";

const API = "https://get-an-expert.example";

function thread(overrides: Partial<ActiveThread> = {}): ActiveThread {
  return {
    requestId: "req_123",
    threadToken: "tok_abc",
    apiBaseUrl: API,
    expertiseArea: "Next.js SSR",
    lastSeenSeq: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("active thread persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gae-thread-"));
    process.env.GET_AN_EXPERT_STATE_DIR = dir;
  });

  afterEach(() => {
    delete process.env.GET_AN_EXPERT_STATE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips save → load", () => {
    saveActiveThread(thread());
    expect(loadActiveThread(API)).toMatchObject({
      requestId: "req_123",
      threadToken: "tok_abc",
      lastSeenSeq: 0,
    });
  });

  it("returns null with no saved thread", () => {
    expect(loadActiveThread(API)).toBeNull();
  });

  it("ignores a thread from a different API base URL", () => {
    saveActiveThread(thread());
    expect(loadActiveThread("https://other.example")).toBeNull();
  });

  it("ignores a thread older than the 30-day retention", () => {
    saveActiveThread(
      thread({ createdAt: new Date(Date.now() - 31 * 86400_000).toISOString() }),
    );
    expect(loadActiveThread(API)).toBeNull();
  });

  it("markSeen only ever advances", () => {
    saveActiveThread(thread({ lastSeenSeq: 5 }));
    markSeen(thread({ lastSeenSeq: 5 }), 3);
    expect(loadActiveThread(API)?.lastSeenSeq).toBe(5);
    markSeen(thread({ lastSeenSeq: 5 }), 9);
    expect(loadActiveThread(API)?.lastSeenSeq).toBe(9);
  });

  it("clearActiveThread removes the file", () => {
    saveActiveThread(thread());
    clearActiveThread();
    expect(loadActiveThread(API)).toBeNull();
  });
});

describe("formatThreadMessages", () => {
  const at = "2026-07-13T12:00:00Z";
  const messages: ThreadMessage[] = [
    { seq: 1, from: "expert", kind: "activity", text: "Priya S. joined the thread", at },
    { seq: 2, from: "expert", kind: "message", text: "It's a timezone bug.", at },
    { seq: 3, from: "user", kind: "message", text: "trying now", at },
    { seq: 4, from: "user", kind: "activity", text: "Progress update — tried: fix", at },
  ];

  it("renders expert messages and activities, skips the user's own", () => {
    const text = formatThreadMessages(messages, "Priya S.");
    expect(text).toContain("**Priya S.:** It's a timezone bug.");
    expect(text).toContain("_Priya S. joined the thread_");
    expect(text).not.toContain("trying now");
    expect(text).not.toContain("Progress update");
  });

  it("falls back to a generic name", () => {
    const text = formatThreadMessages(
      [{ seq: 1, from: "expert", kind: "message", text: "hello", at }],
      null,
    );
    expect(text).toContain("**The expert:** hello");
  });

  it("returns an empty string when nothing is relayable", () => {
    expect(
      formatThreadMessages(
        [{ seq: 1, from: "user", kind: "message", text: "hi", at }],
        null,
      ),
    ).toBe("");
  });
});
