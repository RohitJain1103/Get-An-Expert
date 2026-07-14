#!/usr/bin/env node
/**
 * Get An Expert — session relay hook script.
 *
 * Installed at ~/.get-an-expert/relay.mjs by `get-an-expert init <host>` and
 * invoked by host hooks as: node relay.mjs <host> <event>  (hook JSON on
 * stdin). Design contract (docs/expert-chat-spec.md §5):
 *   - relay.json absent → exit 0 instantly (zero overhead outside sessions)
 *   - pausedUntil in the future → exit 0 (the /pause hard guarantee)
 *   - local redaction + truncation BEFORE anything leaves the machine
 *   - network send happens in a DETACHED child so the user's session never
 *     waits on us; the child self-heals the hard stop by deleting relay.json
 *     when the server answers 410 (chat ended from the other side)
 *   - observe-only: never blocks the host action, never exits non-zero
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { redactText } from "@get-an-expert/core";
import {
  clearRelayFlag,
  expertHomeDir,
  readRelayFlag,
} from "@get-an-expert/core/relay";
import {
  normalizeClaudeCode,
  normalizeCursor,
  normalizeWindsurf,
  truncate,
  type RelayEvent,
} from "./normalize";

const DEFAULT_API_URL = "https://get-an-expert.vercel.app";
const SEND_TIMEOUT_MS = 8_000;
/** Cap transcript reads so Stop hooks stay O(1) on long sessions. */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

interface Spool {
  url: string;
  token: string;
  body: { type: string; text: string };
}

export function outboxDir(): string {
  return join(expertHomeDir(), "outbox");
}

/** Read the whole transcript, or just its tail if huge. */
function readTranscriptTail(path: string): string {
  const size = statSync(path).size;
  if (size <= MAX_TRANSCRIPT_BYTES) return readFileSync(path, "utf8");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(MAX_TRANSCRIPT_BYTES);
    const bytes = readSync(
      fd,
      buf,
      0,
      MAX_TRANSCRIPT_BYTES,
      size - MAX_TRANSCRIPT_BYTES,
    );
    return buf.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

/** Last assistant text from a Claude Code JSONL transcript. */
export function lastAssistantText(transcript: string): string | null {
  const lines = transcript.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "assistant") continue;
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter((block: { type?: string }) => block?.type === "text")
        .map((block: { text?: string }) => block.text ?? "")
        .join("\n")
        .trim();
      if (text) return text;
    } catch {
      // unparseable line — keep scanning
    }
  }
  return null;
}

export function normalizeForHost(
  host: string,
  event: string,
  payload: unknown,
): RelayEvent | null {
  if (host === "claude-code") {
    if (event === "agent-reply") {
      const transcriptPath = (payload as { transcript_path?: string })
        ?.transcript_path;
      if (!transcriptPath) return null;
      let text: string | null = null;
      try {
        text = lastAssistantText(readTranscriptTail(transcriptPath));
      } catch {
        return null;
      }
      return text ? normalizeClaudeCode("agent-reply", { text }) : null;
    }
    return normalizeClaudeCode(event, payload);
  }
  if (host === "cursor") return normalizeCursor(event, payload);
  if (host === "windsurf") return normalizeWindsurf(event, payload);
  return null;
}

export interface RelayRunResult {
  /** JSON to print on stdout (host hook output), or null for silence. */
  stdout: string | null;
  /** Spool file written for the detached sender, or null when nothing sent. */
  spoolPath: string | null;
}

/**
 * The synchronous part of a hook invocation: decide, redact, spool. The
 * caller (main) then spawns the detached sender for spoolPath.
 */
export function runRelay(
  host: string,
  event: string,
  stdinText: string,
  now: Date = new Date(),
): RelayRunResult {
  const flag = readRelayFlag();
  if (!flag) return { stdout: null, spoolPath: null };

  // The RELAY ON indicator rides the Claude Code prompt hook whenever the
  // relay is armed — even while paused (paused ≠ private chat over).
  const banner =
    host === "claude-code" && event === "prompt"
      ? JSON.stringify({
          systemMessage: `🔴 RELAY ON — this session is visible to ${
            flag.expertName ?? "your Get An Expert helper"
          }. Manage it in the chat terminal (/pause, /end).`,
        })
      : null;

  if (flag.pausedUntil && Date.parse(flag.pausedUntil) > now.getTime()) {
    return { stdout: banner, spoolPath: null };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(stdinText);
  } catch {
    return { stdout: banner, spoolPath: null };
  }

  const relayEvent = normalizeForHost(host, event, payload);
  if (!relayEvent) return { stdout: banner, spoolPath: null };

  // Local redaction before anything leaves the machine; server redacts again.
  const text = truncate(redactText(relayEvent.text).text);
  const baseUrl = (flag.apiBaseUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  const spool: Spool = {
    url: `${baseUrl}/api/v1/requests/${flag.requestId}/events`,
    token: flag.chatToken,
    body: { type: relayEvent.type, text },
  };
  mkdirSync(outboxDir(), { recursive: true, mode: 0o700 });
  const spoolPath = join(
    outboxDir(),
    `${randomBytes(8).toString("hex")}.json`,
  );
  writeFileSync(spoolPath, JSON.stringify(spool), {
    encoding: "utf8",
    mode: 0o600,
  });
  return { stdout: banner, spoolPath };
}

/**
 * The detached child: POST one spooled event, then delete the spool. On 410
 * the chat has ended — delete the relay flag so every later hook no-ops
 * (the client side of the hard stop). All failures are silent: relay is
 * best-effort and must never disturb the user's session.
 */
export async function runSend(
  spoolPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let spool: Spool;
  try {
    spool = JSON.parse(readFileSync(spoolPath, "utf8")) as Spool;
  } catch {
    return;
  } finally {
    rmSync(spoolPath, { force: true });
  }
  try {
    const response = await fetchImpl(spool.url, {
      method: "POST",
      headers: {
        "x-chat-token": spool.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(spool.body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.status === 410) clearRelayFlag();
  } catch {
    // Unreachable API: drop the event. Never retry-storm from a hook.
  }
}

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2);
  if (first === "--send") {
    if (second) await runSend(second);
    return;
  }
  const host = first ?? "";
  const event = second ?? "";
  let stdinText = "";
  try {
    stdinText = readFileSync(0, "utf8");
  } catch {
    // no stdin (manual invocation) — treated as unparseable below
  }
  const result = runRelay(host, event, stdinText);
  if (result.spoolPath) {
    spawn(process.execPath, [process.argv[1], "--send", result.spoolPath], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  if (result.stdout) process.stdout.write(result.stdout);
}

// Only run as a script, not when imported by tests.
const isDirectRun =
  process.argv[1] !== undefined &&
  basename(fileURLToPath(import.meta.url)) === basename(process.argv[1]);
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}
