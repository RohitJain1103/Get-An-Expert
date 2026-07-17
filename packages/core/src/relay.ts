/**
 * The local relay flag: ~/.get-an-expert/relay.json.
 *
 * Written by the MCP server at escalation; read by host hook scripts on every
 * event (absent file = relay off = instant no-op); owned by the chat CLI for
 * /end (delete) and /pause (pausedUntil). Owner-only permissions, matching
 * the install-id file. GET_AN_EXPERT_HOME overrides the directory (tests).
 *
 * NOT exported from the core index on purpose: this module touches node:fs
 * and must never leak into the web client bundle. Import via
 * `@get-an-expert/core/relay`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RelayFlag {
  requestId: string;
  chatToken: string;
  apiBaseUrl?: string;
  /** ISO timestamp; hooks skip relaying until this passes. */
  pausedUntil?: string;
  /** Learned from the chat once the expert joins; names the RELAY indicator. */
  expertName?: string;
}

export function expertHomeDir(): string {
  return process.env.GET_AN_EXPERT_HOME ?? join(homedir(), ".get-an-expert");
}

export function relayFilePath(): string {
  return join(expertHomeDir(), "relay.json");
}

export function readRelayFlag(): RelayFlag | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(relayFilePath(), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as RelayFlag).requestId === "string" &&
      typeof (parsed as RelayFlag).chatToken === "string"
    ) {
      return parsed as RelayFlag;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRelayFlag(flag: RelayFlag): void {
  mkdirSync(expertHomeDir(), { recursive: true, mode: 0o700 });
  writeFileSync(relayFilePath(), `${JSON.stringify(flag, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearRelayFlag(): void {
  rmSync(relayFilePath(), { force: true });
}

/**
 * Persistent record of the most recent expert chat. Unlike the relay flag it
 * SURVIVES the chat's end, so the agent can still pull the expert's replies
 * afterwards (transcript reads stay allowed within the retention window).
 */
export interface LastChatRecord {
  requestId: string;
  chatToken: string;
  apiBaseUrl?: string;
  /** High-water mark for check_expert_replies. */
  lastReadSeq: number;
}

export function lastChatFilePath(): string {
  return join(expertHomeDir(), "last-chat.json");
}

export function readLastChat(): LastChatRecord | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(lastChatFilePath(), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LastChatRecord).requestId === "string" &&
      typeof (parsed as LastChatRecord).chatToken === "string"
    ) {
      const record = parsed as Omit<LastChatRecord, "lastReadSeq"> & {
        lastReadSeq?: number;
      };
      return { ...record, lastReadSeq: record.lastReadSeq ?? 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLastChat(record: LastChatRecord): void {
  mkdirSync(expertHomeDir(), { recursive: true, mode: 0o700 });
  writeFileSync(lastChatFilePath(), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Live snapshot of the running expert session, written by the on-machine agent
 * and read by the MCP server's `expert_status` tool. The two run in separate
 * processes on the customer's machine, so this file is how "what has the expert
 * been doing?" gets a fresh answer without a network round-trip. Refreshed on
 * every expert action and state change; removed when the session ends.
 */
export interface SessionStatusActivity {
  at: number;
  kind: string;
  summary: string;
}

export interface SessionStatusRecord {
  state: "idle" | "waiting" | "connected" | "ended";
  sessionId?: string;
  expertName?: string;
  chatUrl?: string;
  /** Snapshot of the approved scopes at the time of writing. */
  permissions?: Record<string, unknown>;
  /** Most recent expert actions, oldest first. */
  recentActivity: SessionStatusActivity[];
  /** Epoch ms of the last write, so readers can show how fresh this is. */
  updatedAt: number;
}

export function sessionStatusFilePath(): string {
  return join(expertHomeDir(), "session-status.json");
}

export function readSessionStatus(): SessionStatusRecord | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(sessionStatusFilePath(), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SessionStatusRecord).state === "string"
    ) {
      const record = parsed as SessionStatusRecord;
      return {
        ...record,
        recentActivity: Array.isArray(record.recentActivity)
          ? record.recentActivity
          : [],
        updatedAt:
          typeof record.updatedAt === "number" ? record.updatedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSessionStatus(record: SessionStatusRecord): void {
  mkdirSync(expertHomeDir(), { recursive: true, mode: 0o700 });
  writeFileSync(
    sessionStatusFilePath(),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function clearSessionStatus(): void {
  rmSync(sessionStatusFilePath(), { force: true });
}

/**
 * Everything the agent needs to rejoin its queued request after the socket
 * drops or the process restarts: the relay session id, the one-time resume
 * token the relay minted (so the reconnect is authenticated, not spoofable),
 * and the approved scopes — persisted so a full process restart can re-arm
 * live access without a fresh approval (bounded by createdAt + the agent's
 * max-age check). Written when the request is registered, updated when scopes
 * are granted, and cleared when the session truly ends.
 */
export interface ResumeGrant {
  files: boolean;
  terminal: boolean;
  browser: boolean;
  browserPort?: number;
}

export interface ResumeRecord {
  sessionId: string;
  /** Raw token the relay returned once; presented on reconnect to resume. */
  resumeToken: string;
  relayUrl: string;
  projectDir: string;
  customerName: string;
  issue?: string;
  /** Approved scopes, present once the user has granted them. */
  grant?: ResumeGrant;
  /** Epoch ms of the original request, for the freshness/max-age check. */
  createdAt: number;
}

export function resumeFilePath(): string {
  return join(expertHomeDir(), "resume.json");
}

export function readResume(): ResumeRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resumeFilePath(), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as ResumeRecord).sessionId === "string" &&
      typeof (parsed as ResumeRecord).resumeToken === "string" &&
      typeof (parsed as ResumeRecord).relayUrl === "string" &&
      typeof (parsed as ResumeRecord).createdAt === "number"
    ) {
      return parsed as ResumeRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeResume(record: ResumeRecord): void {
  mkdirSync(expertHomeDir(), { recursive: true, mode: 0o700 });
  writeFileSync(resumeFilePath(), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearResume(): void {
  rmSync(resumeFilePath(), { force: true });
}
