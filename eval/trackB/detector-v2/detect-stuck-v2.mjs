#!/usr/bin/env node
/**
 * Detector v2 REFERENCE IMPLEMENTATION (eval-only; the shipped plugin is
 * untouched). Same hook contract as detect-stuck.mjs: hook input on stdin,
 * optional hookSpecificOutput on stdout, nudge state under ~/.get-an-expert.
 *
 * Three rule changes over the shipped detector, motivated by replay findings
 * (see ../DETECTOR_V2_SPEC.md):
 *
 *  R1 FIRST-NUDGE DECOUPLING - the renudge-spacing floor applies only after a
 *     first nudge exists. Shipped code accidentally floors the first nudge at
 *     RENUDGE_AFTER (10) prompts, making lower thresholds unreachable.
 *
 *  R2 RECURRENCE, NOT MENTION - a signal is a *recurrence phrase* ("same
 *     error", "still failing", "didn't work again"), not any occurrence of a
 *     failure word. "add error handling please" is a feature request, not a
 *     stuck signal. Signals are counted as turns-with-recurrence inside a
 *     recent window of user turns, so one ranty message can't fire alone.
 *
 *  R3 RECOVERY AWARENESS - if the most recent turns are clean, the session
 *     has moved on; do not nudge on old, already-fixed errors.
 *
 * Env (replay sweeps these):
 *   GAE_MIN_PROMPTS   min user prompts before any nudge      (default 10)
 *   GAE_MIN_ERRORS    min recurrence turns inside the window (default 3)
 *   GAE_WINDOW_TURNS  recent-window size in user turns       (default 6)
 *   GAE_CLEAN_TURNS   consecutive clean recent turns that suppress (default 2)
 *   GAE_RENUDGE_AFTER prompts between nudge 1 and nudge 2    (default 10)
 *   GAE_MAX_NUDGES    per session                            (default 2)
 */
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

function readTranscriptTail(path) {
  const size = statSync(path).size;
  if (size <= MAX_TRANSCRIPT_BYTES) return readFileSync(path, "utf8");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(MAX_TRANSCRIPT_BYTES);
    const bytes = readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, size - MAX_TRANSCRIPT_BYTES);
    return buf.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MIN_USER_PROMPTS = envInt("GAE_MIN_PROMPTS", 10);
const MIN_RECURRENCE_TURNS = envInt("GAE_MIN_ERRORS", 3);
const WINDOW_TURNS = envInt("GAE_WINDOW_TURNS", 6);
const CLEAN_TURNS = envInt("GAE_CLEAN_TURNS", 2);
const RENUDGE_AFTER_PROMPTS = envInt("GAE_RENUDGE_AFTER", 10);
const MAX_NUDGES_PER_SESSION = envInt("GAE_MAX_NUDGES", 2);

/**
 * R2: recurrence phrases only. Two shapes:
 *  - recurrence word near a failure word ("same error", "still failing",
 *    "keeps crashing", "error ... again")
 *  - idioms that are recurrence by themselves ("not working", "didn't work",
 *    "still broken", "going in circles", "same thing")
 */
const RECURRENCE_PATTERN = new RegExp(
  [
    String.raw`\b(?:same|still|again|keeps?|yet another)\b[^.!?\n]{0,50}\b(?:error|errors|fail\w*|crash\w*|issue|exception|traceback|broken|message)\b`,
    String.raw`\b(?:error|errors|fail\w*|crash\w*|issue|exception|traceback)\b[^.!?\n]{0,50}\b(?:again|still|persists?|keeps?|third time|3rd time|4th time)\b`,
    String.raw`\bnot working\b|\bdoesn'?t work\b|\bdidn'?t work\b|\bstill broken\b|\bnothing works\b|\bsame thing\b|\bgoing in circles\b|\bno change\b`,
  ].join("|"),
  "i",
);

/** Failure mention (weaker than recurrence) used only for the R3 clean check. */
const FAILURE_MENTION = /\berror\b|\bfailed\b|\bfailure\b|exception|traceback|\bcrash/i;

/** Parse the transcript into user turns, each with the text of the turn plus
 * the assistant text that followed it (assistant "Still failing..." narration
 * carries recurrence signal too). Tool results and meta entries are skipped,
 * mirroring the shipped prompt-counting rules. */
function parseTurns(raw) {
  const turns = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "user" && !entry.isMeta) {
      const content = entry.message?.content;
      if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) continue;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n")
          : "";
      turns.push({ text });
    } else if (entry.type === "assistant" && turns.length > 0) {
      const blocks = entry.message?.content;
      if (Array.isArray(blocks)) {
        const text = blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
        if (text) turns[turns.length - 1].text += "\n" + text;
      }
    }
  }
  return turns;
}

function main() {
  let hookInput;
  try {
    hookInput = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const transcriptPath = hookInput.transcript_path;
  const sessionId = String(hookInput.session_id ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!transcriptPath || !existsSync(transcriptPath)) return;

  let raw;
  try {
    raw = readTranscriptTail(transcriptPath);
  } catch {
    return;
  }
  const turns = parseTurns(raw);
  const userPrompts = turns.length;
  if (userPrompts < MIN_USER_PROMPTS) return;

  // R2: recurrence turns inside the recent window
  const window = turns.slice(-WINDOW_TURNS);
  const recurrenceTurns = window.filter((t) => RECURRENCE_PATTERN.test(t.text)).length;
  if (recurrenceTurns < MIN_RECURRENCE_TURNS) return;

  // R3: recovery check - if the newest CLEAN_TURNS turns carry no failure
  // mention at all, the session has moved on
  const newest = turns.slice(-CLEAN_TURNS);
  if (newest.every((t) => !FAILURE_MENTION.test(t.text))) return;

  // Nudge state (same location and shape as shipped)
  const stateDir = join(homedir(), ".get-an-expert", "nudges");
  const stateFile = join(stateDir, `${sessionId}.json`);
  let state = { lastNudgePromptCount: 0, nudgeCount: 0 };
  try {
    state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")) };
  } catch {
    // first nudge for this session
  }
  if (state.nudgeCount >= MAX_NUDGES_PER_SESSION) return;
  // R1: spacing floor applies only between nudges, never before the first
  if (
    state.nudgeCount > 0 &&
    userPrompts < state.lastNudgePromptCount + RENUDGE_AFTER_PROMPTS
  )
    return;

  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      stateFile,
      JSON.stringify({ lastNudgePromptCount: userPrompts, nudgeCount: state.nudgeCount + 1 }),
      { mode: 0o600 },
    );
  } catch {
    // stateless fallback: still nudge this once
  }

  const additionalContext =
    `✨ Get An Expert: this session shows stuck signals - ${userPrompts} user ` +
    `messages with the same failure recurring across recent turns. If the user ` +
    `does appear stuck on the same goal and you haven't offered already, consider ` +
    `calling the get-an-expert offer_expert_help tool with a specific expertise ` +
    `area and relaying its consent notice. If the user previously declined, don't offer again.`;

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext } }),
  );
}

main();
