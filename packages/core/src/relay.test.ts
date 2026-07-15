import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRelayFlag,
  readLastChat,
  readRelayFlag,
  writeLastChat,
  writeRelayFlag,
  type RelayFlag,
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
