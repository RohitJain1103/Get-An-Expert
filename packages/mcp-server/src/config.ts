import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SERVER_NAME = "get-an-expert";
export const SERVER_VERSION = "0.3.0";

/** Must match the consent text in consent.ts; bump both together. */
export const CONSENT_TEXT_VERSION = "2026-07-14.v2";

const DEFAULT_API_URL = "https://get-an-expert.vercel.app";

export function apiBaseUrl(): string {
  return (
    process.env.GET_AN_EXPERT_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_URL
  );
}

export function privacyUrl(): string {
  return `${apiBaseUrl()}/privacy`;
}

/**
 * A random UUID persisted on the user's machine. Not linked to any account —
 * used only for rate limiting and so the user's deletion rights work. Treated
 * as personal data under GDPR; never extended into fingerprinting.
 */
export function getInstallId(): string {
  const dir = join(homedir(), ".get-an-expert");
  const file = join(dir, "install-id");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // first run — fall through and create one
  }
  const id = randomUUID();
  try {
    // Restrict to the owner: on shared machines this file shouldn't be
    // world-readable (it keys rate limiting for this install).
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Not being able to persist is fine; a per-session id still works.
  }
  return id;
}
