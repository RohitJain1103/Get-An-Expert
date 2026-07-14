import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The local relay flag: ~/.get-an-expert/relay.json. Written by the MCP
 * server at escalation (Phase B); read by host hook scripts; owned here for
 * /end (delete) and /pause (pausedUntil). Owner-only permissions, matching
 * the install-id file. GET_AN_EXPERT_HOME overrides the directory (tests).
 */
export interface RelayFlag {
  requestId: string;
  chatToken: string;
  apiBaseUrl?: string;
  /** ISO timestamp; hooks skip relaying until this passes. */
  pausedUntil?: string;
}

function relayDir(): string {
  return process.env.GET_AN_EXPERT_HOME ?? join(homedir(), ".get-an-expert");
}

export function relayFilePath(): string {
  return join(relayDir(), "relay.json");
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
  mkdirSync(relayDir(), { recursive: true, mode: 0o700 });
  writeFileSync(relayFilePath(), `${JSON.stringify(flag, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearRelayFlag(): void {
  rmSync(relayFilePath(), { force: true });
}
