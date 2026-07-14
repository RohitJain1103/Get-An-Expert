#!/usr/bin/env node
/**
 * Get An Expert — relay bridge (Claude Code hooks).
 *
 * Forwards this hook invocation to the relay script that escalation installs
 * at ~/.get-an-expert/relay.mjs. No script installed (or no active expert
 * session — the script itself checks relay.json) means exit 0 with zero
 * work: sessions outside an expert chat pay nothing.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const relay = join(
  process.env.GET_AN_EXPERT_HOME ?? join(homedir(), ".get-an-expert"),
  "relay.mjs",
);
if (!existsSync(relay)) process.exit(0);

const event = process.argv[2] ?? "";
const result = spawnSync(process.execPath, [relay, "claude-code", event], {
  stdio: ["inherit", "inherit", "ignore"],
  timeout: 12_000,
});
process.exit(result.status ?? 0);
