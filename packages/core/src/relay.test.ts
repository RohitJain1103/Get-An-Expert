import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRelayFlag,
  clearResume,
  clearSessionStatus,
  readLastChat,
  readRelayFlag,
  readResume,
  readSessionStatus,
  writeLastChat,
  writeRelayFlag,
  writeResume,
  writeSessionStatus,
  type RelayFlag,
  type ResumeRecord,
  type SessionStatusRecord,
} from "./relay";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-relay-"));
  process.env.GET_AN_EXPERT_HOME = dir;
});

afterEach(() => {
  delete process.env.GET_AN_EXPERT_HOME;
});

const flag: RelayFlag = {
  requestId: "req_a",
  chatToken: "tok",
  apiBaseUrl: "https://example.test",
};

describe("relay flag file", () => {
  it("round-trips", () => {
    writeRelayFlag(flag);
    expect(readRelayFlag()).toEqual(flag);
  });

  it("is owner-only (0600)", () => {
    writeRelayFlag(flag);
    const mode = statSync(join(dir, "relay.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when absent, corrupt, or missing fields", () => {
    expect(readRelayFlag()).toBeNull();
    writeFileSync(join(dir, "relay.json"), "not json");
    expect(readRelayFlag()).toBeNull();
    writeFileSync(join(dir, "relay.json"), JSON.stringify({ requestId: "x" }));
    expect(readRelayFlag()).toBeNull();
  });

  it("clearRelayFlag removes it; clearing twice is fine", () => {
    writeRelayFlag(flag);
    clearRelayFlag();
    expect(readRelayFlag()).toBeNull();
    clearRelayFlag();
  });

  it("carries pausedUntil and expertName updates", () => {
    writeRelayFlag(flag);
    writeRelayFlag({
      ...flag,
      pausedUntil: "2026-07-14T03:00:00.000Z",
      expertName: "Priya",
    });
    const read = readRelayFlag();
    expect(read?.pausedUntil).toBe("2026-07-14T03:00:00.000Z");
    expect(read?.expertName).toBe("Priya");
  });
});

describe("last-chat record", () => {
  it("round-trips with lastReadSeq and is 0600", () => {
    writeLastChat({
      requestId: "req_a",
      chatToken: "tok",
      apiBaseUrl: "https://example.test",
      lastReadSeq: 7,
    });
    expect(readLastChat()).toEqual({
      requestId: "req_a",
      chatToken: "tok",
      apiBaseUrl: "https://example.test",
      lastReadSeq: 7,
    });
    const mode = statSync(join(dir, "last-chat.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("defaults lastReadSeq to 0 for older files and null when absent/corrupt", () => {
    expect(readLastChat()).toBeNull();
    writeFileSync(
      join(dir, "last-chat.json"),
      JSON.stringify({ requestId: "req_a", chatToken: "tok" }),
    );
    expect(readLastChat()?.lastReadSeq).toBe(0);
    writeFileSync(join(dir, "last-chat.json"), "nope");
    expect(readLastChat()).toBeNull();
  });

  it("is independent of the relay flag lifecycle", () => {
    writeRelayFlag(flag);
    writeLastChat({ requestId: "req_a", chatToken: "tok", lastReadSeq: 0 });
    clearRelayFlag();
    expect(readLastChat()?.requestId).toBe("req_a");
  });
});

describe("session-status record", () => {
  const record: SessionStatusRecord = {
    state: "connected",
    sessionId: "sess_a",
    expertName: "Priya",
    chatUrl: "https://relay.test/chat#sess_a.tok",
    permissions: { files: true, terminal: true, browser: false },
    recentActivity: [
      { at: 1, kind: "read_file", summary: "Expert reading: src/app.ts" },
      { at: 2, kind: "run_command", summary: "Expert ran: npm test" },
    ],
    updatedAt: 3,
  };

  it("round-trips and is owner-only (0600)", () => {
    writeSessionStatus(record);
    expect(readSessionStatus()).toEqual(record);
    const mode = statSync(join(dir, "session-status.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when absent or corrupt", () => {
    expect(readSessionStatus()).toBeNull();
    writeFileSync(join(dir, "session-status.json"), "not json");
    expect(readSessionStatus()).toBeNull();
  });

  it("clears on session end", () => {
    writeSessionStatus(record);
    clearSessionStatus();
    expect(readSessionStatus()).toBeNull();
  });

  it("tolerates a missing recentActivity array", () => {
    writeFileSync(
      join(dir, "session-status.json"),
      JSON.stringify({ state: "waiting" }),
    );
    const read = readSessionStatus();
    expect(read?.state).toBe("waiting");
    expect(read?.recentActivity).toEqual([]);
  });
});

describe("resume record", () => {
  const resume: ResumeRecord = {
    sessionId: "sess_a",
    resumeToken: "rt_abc",
    relayUrl: "wss://relay.test",
    projectDir: "/home/dev/project",
    customerName: "Dana",
    issue: "build is broken",
    grant: { files: true, terminal: true, browser: true, browserPort: 3000 },
    createdAt: 1_700_000_000_000,
  };

  it("round-trips and is owner-only (0600)", () => {
    writeResume(resume);
    expect(readResume()).toEqual(resume);
    const mode = statSync(join(dir, "resume.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when absent, corrupt, or missing required fields", () => {
    expect(readResume()).toBeNull();
    writeFileSync(join(dir, "resume.json"), "not json");
    expect(readResume()).toBeNull();
    writeFileSync(
      join(dir, "resume.json"),
      JSON.stringify({ sessionId: "sess_a" }),
    );
    expect(readResume()).toBeNull();
  });

  it("round-trips without an optional grant (request queued but not yet approved)", () => {
    const { grant: _grant, issue: _issue, ...minimal } = resume;
    writeResume(minimal);
    const read = readResume();
    expect(read?.sessionId).toBe("sess_a");
    expect(read?.grant).toBeUndefined();
  });

  it("clearResume removes it; clearing twice is fine", () => {
    writeResume(resume);
    clearResume();
    expect(readResume()).toBeNull();
    clearResume();
  });
});
