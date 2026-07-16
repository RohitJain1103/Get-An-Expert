import type { SessionState } from "./agent-session";

/**
 * Customer-facing walk-away copy. Every message the customer reads after
 * approving scopes lives here so the promise stays consistent: leave this
 * chat open, keep the machine on and awake, and the expert works without
 * you — every action logged, everything revocable.
 */

/** Queue confirmation returned by request_expert_help right after approval.
 * The chat-link clause only appears when a chat URL actually exists (old
 * relays don't mint customer tokens). */
export function queueMessage(chatUrl?: string): string {
  const base =
    "You're in the expert queue — you can walk away now. Leave this chat open and your machine on and awake (don't close the laptop); an expert will pick this up and work within the scopes you approved, with every action logged.";
  return chatUrl
    ? `${base} Check back anytime with expert_status, or message the expert from any device using the chat link above.`
    : `${base} Check back anytime with expert_status.`;
}

/** Per-state status line prepended to every expert_status response. */
export function statusMessage(state: SessionState, expertName?: string): string {
  switch (state) {
    case "waiting":
      return "Still in the queue — no expert has joined yet. You don't have to wait here: leave this chat open and your machine awake, step away, and check back later.";
    case "connected":
      return `${expertName ?? "An expert"} is working on your machine right now, within the scopes you approved — every action is in the log below. Feel free to step away (keep the machine awake); check back whenever you like.`;
    case "ended":
      return "This session has ended and all expert access is revoked.";
    case "idle":
      return "No expert session is active. Call request_expert_help to start one.";
  }
}

/** Confirmation returned by end_session. */
export const END_SESSION_MESSAGE = "Session ended — all expert access is revoked.";
