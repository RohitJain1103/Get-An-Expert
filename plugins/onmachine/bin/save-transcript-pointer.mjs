#!/usr/bin/env node
/**
 * Get An Expert: transcript pointer (PreToolUse hook on request_expert_help).
 *
 * Runs just before the agent's request_expert_help tool. Records WHERE the
 * current Claude Code transcript lives (nothing more) so the agent can,
 * with the user's explicit consent (the "Share this conversation" checkbox),
 * include the conversation in the expert's local CONTEXT.md. This script
 * sends nothing anywhere and reads no transcript content; it only writes a
 * tiny pointer file under ~/.get-an-expert. Always exits 0: a failed pointer
 * write must never block the expert request (the agent degrades to
 * summary-only context).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function main() {
  let hookInput;
  try {
    hookInput = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const transcriptPath = hookInput?.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) return;
  const sessionId = String(hookInput.session_id ?? "unknown");

  const home =
    process.env.GET_AN_EXPERT_HOME?.trim() || join(homedir(), ".get-an-expert");
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(home, "transcript-pointer.json"),
      JSON.stringify({ transcriptPath, sessionId, savedAt: Date.now() }),
      { mode: 0o600 },
    );
  } catch {
    // best-effort: without the pointer the agent falls back to summary-only
  }
}

main();
