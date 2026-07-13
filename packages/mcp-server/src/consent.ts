import { privacyUrl } from "./config";

/**
 * The consent notice shown to the user before anything can be sent.
 * This copy is load-bearing for compliance (explicit opt-in, "what we
 * send / never send" pairing, retention + deletion) —
 * bump CONSENT_TEXT_VERSION in config.ts whenever it changes.
 */
export function buildOfferMessage(expertiseArea: string): string {
  return [
    `✨ **Looks like you're stuck. Want an expert eye on this ${expertiseArea} problem?**`,
    "",
    "Here's the deal: with your OK, Get An Expert sends **one structured summary** of " +
      "where this session is stuck to its API. That opens a private thread with a " +
      "real human expert, who replies with a diagnosis plus the exact next steps — " +
      "and you can keep talking to them from right here (\"tell the expert …\") " +
      "until it's solved.",
    "",
    "**What gets sent (only if you say yes):** your goal, what's been tried, error " +
      "messages, a short session summary, and your tech stack. Later messages and " +
      "progress updates go to the expert only when you choose to send them, and " +
      "you see each one before it goes.",
    "**Never sent:** your source files, the full conversation, environment variables, " +
      "or secrets — redaction runs on your machine before anything leaves it.",
    "",
    `The thread and everything on it auto-deletes after 30 days, and the ` +
      `confirmation includes a private deletion link. Privacy policy: ${privacyUrl()}`,
    "",
    "**Send it? (yes / no)**",
  ].join("\n");
}

export function buildDeclinedMessage(): string {
  return "No problem — nothing was sent. If you change your mind later, just ask for an expert.";
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
