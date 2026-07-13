import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ThreadMessage } from "@get-an-expert/core";

/**
 * The one open expert thread for this install, persisted locally so it
 * survives new sessions (and /clear). Contains the thread token — the file
 * is created owner-only, like the install id.
 */
export interface ActiveThread {
  requestId: string;
  threadToken: string;
  /** API the thread lives on; a thread is ignored if the URL changes. */
  apiBaseUrl: string;
  expertiseArea: string;
  /** Highest message seq already relayed to the user. */
  lastSeenSeq: number;
  createdAt: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Overridable for tests. */
export function stateDir(): string {
  return (
    process.env.GET_AN_EXPERT_STATE_DIR ?? join(homedir(), ".get-an-expert")
  );
}

const threadFile = (): string => join(stateDir(), "thread.json");

export function saveActiveThread(thread: ActiveThread): void {
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    writeFileSync(threadFile(), `${JSON.stringify(thread, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Not being able to persist only costs cross-session resume.
  }
}

/**
 * Returns the active thread, or null when there is none, it belongs to a
 * different API, or it has outlived the server's 30-day retention (the
 * server side is gone by then anyway).
 */
export function loadActiveThread(currentApiBaseUrl: string): ActiveThread | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(threadFile(), "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const t = parsed as Partial<ActiveThread>;
  if (
    typeof t.requestId !== "string" ||
    typeof t.threadToken !== "string" ||
    typeof t.apiBaseUrl !== "string" ||
    typeof t.expertiseArea !== "string" ||
    typeof t.lastSeenSeq !== "number" ||
    typeof t.createdAt !== "string"
  ) {
    return null;
  }
  if (t.apiBaseUrl !== currentApiBaseUrl) return null;
  const age = Date.now() - Date.parse(t.createdAt);
  if (!Number.isFinite(age) || age > THIRTY_DAYS_MS) return null;
  return t as ActiveThread;
}

export function clearActiveThread(): void {
  try {
    rmSync(threadFile(), { force: true });
  } catch {
    // Nothing to clear.
  }
}

export function markSeen(thread: ActiveThread, upToSeq: number): void {
  if (upToSeq > thread.lastSeenSeq) {
    saveActiveThread({ ...thread, lastSeenSeq: upToSeq });
  }
}

/* ------------------------------------------------------------------ */
/* Rendering thread updates for the host to relay verbatim             */
/* ------------------------------------------------------------------ */

export function formatThreadMessages(
  messages: ThreadMessage[],
  expertName: string | null,
): string {
  const name = expertName ?? "The expert";
  return messages
    .map((m) => {
      if (m.kind === "activity") {
        return m.from === "expert" ? `· _${m.text}_` : null; // skip echoes of the user's own updates
      }
      if (m.from === "expert") {
        return `👤 **${name}:** ${m.text}`;
      }
      return null; // the user's own messages need no relay
    })
    .filter((line): line is string => line !== null)
    .join("\n\n");
}
