/**
 * Tests for the Flow B stuck-session detector (Stop hook).
 *
 * Each case spawns the real hook as a child process, feeding it a synthetic
 * hook payload on stdin (as Claude Code does) and a synthetic transcript on
 * disk. HOME is pointed at a fresh temp dir so the anti-nag state file is
 * isolated per test without changing the detector itself.
 *
 * Run: node --test plugins/onmachine/bin/detect-stuck.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "detect-stuck.mjs");

/** One real user prompt line (string content, so it is not a tool result). */
function userLine(text) {
  return JSON.stringify({ type: "user", message: { content: text } });
}

/**
 * Build a transcript with `plainCount` benign prompts plus one prompt per
 * error phrase. Total user prompts = plainCount + errorPhrases.length; total
 * error signals ~= errorPhrases.length (one keyword each).
 */
function buildTranscript(plainCount, errorPhrases = []) {
  const lines = [];
  for (let i = 0; i < plainCount; i++) {
    lines.push(userLine(`plain question ${i} about the project layout`));
  }
  for (const phrase of errorPhrases) lines.push(userLine(phrase));
  return lines.join("\n") + "\n";
}

const THREE_ERRORS = ["it failed to build", "still broken", "same issue as before"];

function freshHome() {
  return mkdtempSync(join(tmpdir(), "gae-home-"));
}

function stateFileFor(home, sessionId) {
  return join(home, ".get-an-expert", "nudges", `${sessionId}.json`);
}

function seedState(home, sessionId, state) {
  const dir = join(home, ".get-an-expert", "nudges");
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFileFor(home, sessionId), JSON.stringify(state));
}

/** Spawn the hook. Returns the spawnSync result (stdout is a string). */
function runHook({ home, transcript, sessionId = "sess", envOverrides = {} }) {
  const work = mkdtempSync(join(tmpdir(), "gae-work-"));
  const transcriptPath = join(work, "transcript.jsonl");
  writeFileSync(transcriptPath, transcript);
  const input = JSON.stringify({
    transcript_path: transcriptPath,
    session_id: sessionId,
  });
  return spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...envOverrides },
  });
}

test("nudges once past both thresholds, pointing at /get-an-expert", () => {
  const home = freshHome();
  const res = runHook({
    home,
    sessionId: "hit",
    transcript: buildTranscript(10, THREE_ERRORS), // 13 prompts, 3 error signals
  });

  assert.equal(res.status, 0);
  assert.notEqual(res.stdout.trim(), "", "expected a nudge on stdout");

  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "Stop");
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\/get-an-expert/, "nudge must point at the Flow B command");
  assert.doesNotMatch(ctx, /offer_expert_help/, "must not name the Flow A tool");
  assert.doesNotMatch(ctx, /—/, "no em dashes in the nudge copy");

  // First nudge recorded state so it will not fire twice.
  const state = JSON.parse(readFileSync(stateFileFor(home, "hit"), "utf8"));
  assert.equal(state.nudgeCount, 1);
  assert.equal(state.lastNudgePromptCount, 13);
});

test("silent below the user-prompt bar", () => {
  const home = freshHome();
  const res = runHook({
    home,
    transcript: buildTranscript(5, THREE_ERRORS), // 8 prompts (< 10), errors are plentiful
  });
  assert.equal(res.stdout.trim(), "", "should stay silent under the prompt bar");
});

test("silent below the error-signal bar", () => {
  const home = freshHome();
  const res = runHook({
    home,
    transcript: buildTranscript(12, ["one lonely failure"]), // 13 prompts, 1 error
  });
  assert.equal(res.stdout.trim(), "", "should stay silent under the error bar");
});

test("silent after the per-session cap is reached", () => {
  const home = freshHome();
  seedState(home, "capped", { nudgeCount: 1, lastNudgePromptCount: 13 });
  const res = runHook({
    home,
    sessionId: "capped",
    transcript: buildTranscript(20, THREE_ERRORS), // 23 prompts, plenty of errors
  });
  assert.equal(
    res.stdout.trim(),
    "",
    "MAX_NUDGES=1 reached, must not nudge again",
  );
});

test("respects existing nudge state: re-nudge spacing (with cap raised)", () => {
  const home = freshHome();
  seedState(home, "spaced", { nudgeCount: 1, lastNudgePromptCount: 13 });

  // +2 prompts since last nudge (< RENUDGE_AFTER 10): still silent even at MAX 2.
  const tooSoon = runHook({
    home,
    sessionId: "spaced",
    transcript: buildTranscript(12, THREE_ERRORS), // 15 prompts
    envOverrides: { GAE_MAX_NUDGES: "2" },
  });
  assert.equal(tooSoon.stdout.trim(), "", "too soon since last nudge, stay silent");

  // +12 prompts since last nudge (>= RENUDGE_AFTER): now it may nudge again.
  const spacedOut = runHook({
    home,
    sessionId: "spaced",
    transcript: buildTranscript(22, THREE_ERRORS), // 25 prompts
    envOverrides: { GAE_MAX_NUDGES: "2" },
  });
  assert.notEqual(
    spacedOut.stdout.trim(),
    "",
    "past the spacing gap with cap 2, should nudge",
  );
});

test("silent on a malformed hook payload (fail-safe)", () => {
  const home = freshHome();
  const work = mkdtempSync(join(tmpdir(), "gae-work-"));
  writeFileSync(join(work, "unused.jsonl"), "");
  const res = spawnSync(process.execPath, [HOOK], {
    input: "not json at all",
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(res.status, 0, "must exit cleanly");
  assert.equal(res.stdout.trim(), "", "no output on bad input");
});
