#!/usr/bin/env node
/**
 * Get An Expert — expert-reply ping (Claude Code Stop hook).
 *
 * When an expert thread is open (~/.get-an-expert/thread.json, written by the
 * MCP server after the user's explicit consent), this hook polls the thread —
 * at most once per POLL_INTERVAL — and, if the expert has replied since the
 * last ping, injects a one-line notice so Claude relays the reply via the
 * check_expert_messages tool. It sends nothing except the thread credentials,
 * never re-notifies about the same message, and fails silent on any error.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POLL_INTERVAL_MS = envInt("GAE_REPLY_POLL_SECONDS", 45) * 1000;
const FETCH_TIMEOUT_MS = 3000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stateRoot() {
  return process.env.GET_AN_EXPERT_STATE_DIR ?? join(homedir(), ".get-an-expert");
}

function loadThread() {
  let thread;
  try {
    thread = JSON.parse(readFileSync(join(stateRoot(), "thread.json"), "utf8"));
  } catch {
    return null;
  }
  if (
    typeof thread?.requestId !== "string" ||
    typeof thread?.threadToken !== "string" ||
    typeof thread?.apiBaseUrl !== "string" ||
    typeof thread?.createdAt !== "string"
  ) {
    return null;
  }
  const age = Date.now() - Date.parse(thread.createdAt);
  if (!Number.isFinite(age) || age > THIRTY_DAYS_MS) return null;
  return thread;
}

async function main() {
  // Consume the hook input; this hook doesn't need it.
  try {
    readFileSync(0, "utf8");
  } catch {
    // stdin may be empty — fine
  }

  const thread = loadThread();
  if (!thread) return;

  const stateDir = join(stateRoot(), "nudges");
  const stateFile = join(stateDir, `replies-${thread.requestId}.json`);
  let state = { lastPollAt: 0, lastNotifiedSeq: 0 };
  try {
    state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")) };
  } catch {
    // first poll for this thread
  }
  if (Date.now() - state.lastPollAt < POLL_INTERVAL_MS) return;

  // Only messages the MCP server hasn't already relayed matter.
  const after = Math.max(state.lastNotifiedSeq, thread.lastSeenSeq ?? 0);

  let payload;
  try {
    const response = await fetch(
      `${thread.apiBaseUrl}/api/v1/requests/${thread.requestId}/messages?after=${after}`,
      {
        headers: { authorization: `Bearer ${thread.threadToken}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      // Record the attempt so a broken thread doesn't get polled every turn.
      persistState(stateDir, stateFile, { ...state, lastPollAt: Date.now() });
      return;
    }
    payload = await response.json();
  } catch {
    persistState(stateDir, stateFile, { ...state, lastPollAt: Date.now() });
    return;
  }

  const messages = Array.isArray(payload?.data?.messages)
    ? payload.data.messages
    : [];
  const expertReplies = messages.filter(
    (m) => m?.from === "expert" && m?.kind === "message",
  );
  const maxSeq = messages.reduce(
    (top, m) => (typeof m?.seq === "number" && m.seq > top ? m.seq : top),
    after,
  );
  persistState(stateDir, stateFile, {
    lastPollAt: Date.now(),
    lastNotifiedSeq: maxSeq,
  });
  if (expertReplies.length === 0) return;

  const expertName = payload?.data?.expertName;
  const who = typeof expertName === "string" && expertName ? expertName : "The expert";
  const additionalContext =
    `🔔 Get An Expert: ${who} replied on the expert thread ` +
    `(${expertReplies.length} new message${expertReplies.length > 1 ? "s" : ""}). ` +
    `Call the get-an-expert check_expert_messages tool and relay the reply to the user.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext,
      },
    }),
  );
}

function persistState(dir, file, state) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // stateless fallback — worst case we poll again next turn
  }
}

main().catch(() => {
  // Fail silent: a ping helper must never break the user's session.
});
