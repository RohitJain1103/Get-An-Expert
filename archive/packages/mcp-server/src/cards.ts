import { homedir } from "node:os";
import type { SessionStatusRecord } from "@get-an-expert/core/relay";

/**
 * Structured data the MCP Apps cards render, paired with the plain-text
 * content every tool still returns for hosts without Apps UI. Pure mapping
 * functions so the tool handlers stay thin and this stays testable.
 */

export const CONSENT_RESOURCE_URI = "ui://get-an-expert/consent.html";
export const STATUS_RESOURCE_URI = "ui://get-an-expert/status.html";

export interface ConsentCardData {
  card: "consent";
  expertiseArea: string;
  projectDir: string;
  privacyUrl: string;
  [key: string]: unknown;
}

export interface StatusCardData {
  card: "status";
  state: SessionStatusRecord["state"];
  expertName?: string;
  chatUrl?: string;
  profile?: SessionStatusRecord["expertProfile"];
  lastDelivery?: SessionStatusRecord["lastDelivery"];
  startedAt?: number;
  updatedAt?: number;
  activity: { at: number; kind: string; summary: string }[];
  [key: string]: unknown;
}

/** Shorten an absolute path under the home directory to ~/…, for display. */
export function tildify(dir: string, home: string = homedir()): string {
  if (home && (dir === home || dir.startsWith(`${home}/`))) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}

export function consentCardData(
  expertiseArea: string,
  privacy: string,
  projectDir: string = process.cwd(),
): ConsentCardData {
  return {
    card: "consent",
    expertiseArea,
    projectDir: tildify(projectDir),
    privacyUrl: privacy,
  };
}

export function statusCardData(
  status: SessionStatusRecord | null,
): StatusCardData {
  if (!status || status.state === "idle" || status.state === "ended") {
    return { card: "status", state: "idle", activity: [] };
  }
  return {
    card: "status",
    state: status.state,
    expertName: status.expertName,
    chatUrl: status.chatUrl,
    profile: status.expertProfile,
    lastDelivery: status.lastDelivery,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    activity: (status.recentActivity ?? [])
      .slice(-20)
      .map((a) => ({ at: a.at, kind: a.kind, summary: a.summary })),
  };
}
