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
