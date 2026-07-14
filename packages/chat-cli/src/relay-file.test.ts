import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRelayFlag,
  readRelayFlag,
  writeRelayFlag,
  type RelayFlag,
} from "./relay-file";

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

  it("updates pausedUntil in place", () => {
    writeRelayFlag(flag);
    writeRelayFlag({ ...flag, pausedUntil: "2026-07-13T03:00:00.000Z" });
    expect(readRelayFlag()?.pausedUntil).toBe("2026-07-13T03:00:00.000Z");
  });
});
