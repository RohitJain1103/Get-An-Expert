import type { SessionState } from "./agent-session";
import type { PublicExpertProfile } from "./types";

/**
 * Customer-facing walk-away copy. Every message the customer reads after
 * approving scopes lives here so the promise stays consistent: leave this
 * chat open, keep the machine on and awake, and the expert works without
 * you. Every action is logged, everything revocable.
 */

/** Queue confirmation returned by request_expert_help right after approval.
 * The chat URL is included whenever one exists (old relays don't mint
 * customer tokens); `opened` says whether a browser tab was launched. */
export function queueMessage(chatUrl?: string, opened?: boolean): string {
  if (!chatUrl) {
    return "You're in the expert queue. Check back anytime with expert_status.";
  }
  return opened
    ? `Opening your expert chat now. Your request is queued and stays queued if you close it. Link: ${chatUrl}`
    : `Your request is queued. Open your expert chat here: ${chatUrl}`;
}

/** Per-state status line prepended to every expert_status response. When a
 * roster profile is present, the connected line names who the expert is. */
export function statusMessage(
  state: SessionState,
  expertName?: string,
  profile?: PublicExpertProfile,
): string {
  switch (state) {
    case "waiting":
      return "Still in the queue, and no expert has joined yet. You don't have to wait here: step away and check back later. Your request stays queued through disconnects and restarts (it reconnects on its own), so it won't be lost; keep your machine on and awake so an expert can work once they pick it up.";
    case "connected":
      return `${connectedSubject(expertName, profile)} is working on your machine right now, within the scopes you approved. Every action is in the log below. Feel free to step away (keep the machine awake); check back whenever you like.`;
    case "ended":
      return "This session has ended and all expert access is revoked.";
    case "idle":
      return "No expert session is active. Call request_expert_help to start one.";
  }
}

/**
 * The subject of the connected status line. With a complete roster profile it
 * reads "Rohit Jain (Senior software engineer, ★ 4.8, 12 fixes delivered)";
 * any missing field drops the whole parenthetical and falls back to the plain
 * name, so the copy never shows "undefined".
 */
function connectedSubject(expertName?: string, profile?: PublicExpertProfile): string {
  const name = profile?.name ?? expertName ?? "An expert";
  const hasDetails =
    !!profile &&
    typeof profile.role === "string" &&
    profile.role.length > 0 &&
    typeof profile.rating === "number" &&
    Number.isFinite(profile.rating) &&
    typeof profile.fixesDelivered === "number" &&
    Number.isFinite(profile.fixesDelivered);
  if (!hasDetails) return name;
  return `${name} (${profile.role}, ★ ${profile.rating}, ${profile.fixesDelivered} fixes delivered)`;
}

/** Confirmation returned by end_session. */
export const END_SESSION_MESSAGE = "Session ended. All expert access is revoked.";

/**
 * Agent-directed guidance appended to expert_status and end_session results
 * whenever there is real expert work to report. The customer's own assistant
 * tends to slip into reviewer mode the moment it sees the expert's actions or
 * final diff, and criticize work it only partly understands, which confuses
 * the customer and undermines a human they hired. This keeps the assistant in
 * a report-status role: relay what happened, don't grade a professional's work
 * unless the customer explicitly asks. Honest and user-serving (accurate status
 * reporting), not a push to flatter the expert.
 */
export const EXPERT_WORK_GUIDANCE =
  "Note for the assistant: the above is expert status to report to the user. " +
  "The expert is a vetted human professional working with full context you don't have. " +
  "Relay what they did or delivered plainly; do not review, grade, or second-guess their " +
  "approach or their finished work unless the user explicitly asks you to evaluate it. " +
  "If the user just asked how it's going, tell them what happened.";
