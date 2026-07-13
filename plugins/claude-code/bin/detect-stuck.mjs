#!/usr/bin/env node
/**
 * Get An Expert — stuck-session detector (Claude Code Stop hook).
 *
 * Runs after each Claude turn. Reads the session transcript, counts real user
 * prompts and recent failure signals, and — past the thresholds — injects a
 * one-line nudge so Claude considers offering Get An Expert. The nudge fires
 * at most twice per session and sends NOTHING anywhere: actual data transfer
 * only ever happens through the MCP tool after the user's explicit consent.
 *
 * Reads only the local transcript file Claude Code provides to hooks; keeps a
 * tiny local state file under ~/.get-an-expert/nudges to avoid re-nudging.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIN_USER_PROMPTS = envInt("GAE_MIN_PROMPTS", 10);
const MIN_ERROR_SIGNALS = envInt("GAE_MIN_ERRORS", 3);
const RENUDGE_AFTER_PROMPTS = envInt("GAE_RENUDGE_AFTER", 10);
const MAX_NUDGES_PER_SESSION = envInt("GAE_MAX_NUDGES", 2);

const ERROR_PATTERN =
  /\berror\b|\bfailed\b|\bfailure\b|exception|traceback|not working|still broken|doesn't work|didn't work|same issue|still (?:failing|getting|seeing)/gi;

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function countUserPrompts(lines) {
  let count = 0;
  for (const line of lines) {
    if (!line.includes('"user"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "user" || entry.isMeta) continue;
      const content = entry.message?.content;
      // Tool results arrive as user-type entries; don't count them as prompts.
      const isToolResult =
        Array.isArray(content) &&
        content.some((block) => block?.type === "tool_result");
      if (!isToolResult) count += 1;
    } catch {
      // unparseable line — skip
    }
  }
  return count;
}

function main() {
  let hookInput;
  try {
    hookInput = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const transcriptPath = hookInput.transcript_path;
  const sessionId = String(hookInput.session_id ?? "unknown").replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
  if (!transcriptPath || !existsSync(transcriptPath)) return;

  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n").filter(Boolean);

  const userPrompts = countUserPrompts(lines);
  if (userPrompts < MIN_USER_PROMPTS) return;

  const recentTail = lines.slice(-400).join("\n");
  const errorSignals = (recentTail.match(ERROR_PATTERN) ?? []).length;
  if (errorSignals < MIN_ERROR_SIGNALS) return;

  // Nudge state: never nag. At most MAX_NUDGES per session, spaced out.
  const stateDir = join(homedir(), ".get-an-expert", "nudges");
  const stateFile = join(stateDir, `${sessionId}.json`);
  let state = { lastNudgePromptCount: 0, nudgeCount: 0 };
  try {
    state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")) };
  } catch {
    // first nudge for this session
  }
  if (state.nudgeCount >= MAX_NUDGES_PER_SESSION) return;
  if (userPrompts < state.lastNudgePromptCount + RENUDGE_AFTER_PROMPTS) return;

  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        lastNudgePromptCount: userPrompts,
        nudgeCount: state.nudgeCount + 1,
      }),
    );
  } catch {
    // stateless fallback: still nudge this once
  }

  const additionalContext =
    `✨ Get An Expert: this session shows stuck signals — ${userPrompts} user ` +
    `messages with repeated failure indicators. If the user does appear stuck on ` +
    `the same goal and you haven't offered already, consider calling the ` +
    `get-an-expert offer_expert_help tool with a specific expertise area and ` +
    `relaying its consent notice. If the user previously declined, don't offer again.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext,
      },
    }),
  );
}

main();
