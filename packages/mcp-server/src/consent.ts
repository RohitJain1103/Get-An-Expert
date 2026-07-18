import { privacyUrl } from "./config";

/**
 * The consent notice shown to the user before anything can be sent.
 * This copy is load-bearing for compliance (explicit opt-in, "what we
 * send / never send" pairing, AI disclosure, retention + deletion).
 * Bump CONSENT_TEXT_VERSION in config.ts whenever it changes.
 */
export function buildOfferMessage(expertiseArea: string): string {
  return [
    `**Looks like you're stuck. Want a human expert on this ${expertiseArea} problem?**`,
    "",
    "Here is exactly how it works. This is the only time we ask, so it is all here:",
    "",
    "**What gets sent (only if you proceed):** one structured summary: your goal, " +
      "what you have tried, error messages, a short session summary, and your tech " +
      "stack, reviewed by a real person, never by an AI pipeline. Your OS account " +
      "name is included too, so the expert knows who they are helping (the same " +
      "name shown in your live session). Override it with GET_AN_EXPERT_CUSTOMER_NAME, " +
      "or just tell the agent to use a different name. A **live chat terminal opens " +
      "where a human expert joins you**. The chat is human to human, and no AI reads it.",
    "",
    "**While the chat is open:** from your \"proceed\" until the chat ends, this " +
      "working session (your prompts, your agent's replies, the commands your " +
      "agent runs and their output, and file edits) is relayed live to the " +
      "expert, so they can watch real attempts instead of retellings. Nothing " +
      "outside this session is read. A **🟢 LIVE** indicator shows while it is active.",
    "",
    "**Never sent:** your source files, environment variables, or anything outside " +
      "this session's activity. Secrets are redacted locally, before anything is " +
      "sent, and again server-side.",
    "",
    "**You stay in control:** you or the expert can end it anytime. Type /end in " +
      "the chat terminal, or just ask here. The moment it ends, nothing relays " +
      "anymore. /pause pauses relaying without ending the chat.",
    "",
    `Everything auto-deletes after 30 days, and you get a private deletion link. ` +
      `Privacy policy: ${privacyUrl()}`,
    "",
    "**Proceed? (yes / no)**",
  ].join("\n");
}

export function buildDeclinedMessage(): string {
  return "No problem. Nothing was sent. If you change your mind later, just ask for an expert.";
}

export function buildConsentRequiredMessage(): string {
  return (
    "Not sent: this tool needs the user's explicit OK first. Show the user the " +
    "consent notice from offer_expert_help and only retry after they clearly agree."
  );
}

export function buildElicitationFailedMessage(): string {
  return (
    "Not sent: the confirmation step could not be completed, so nothing was " +
    "transmitted. Please try again, and confirm when the prompt appears."
  );
}
