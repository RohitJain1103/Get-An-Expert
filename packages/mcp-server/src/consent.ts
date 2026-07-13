import { privacyUrl } from "./config";

/**
 * The consent notice shown to the user before anything can be sent.
 * This copy is load-bearing for compliance (explicit opt-in, "what we
 * send / never send" pairing, AI disclosure, retention + deletion) —
 * bump CONSENT_TEXT_VERSION in config.ts whenever it changes.
 */
export function buildOfferMessage(expertiseArea: string): string {
  return [
    `✨ **Looks like you're stuck. Want an expert eye on this ${expertiseArea} problem?**`,
    "",
    "Here's the deal: with your OK, Get An Expert sends **one structured summary** of " +
      "where this session is stuck to its API, and you get back a diagnosis plus the " +
      "exact prompt to try next. Today that first response is AI-assisted triage " +
      "(it's labeled as such) — human experts are joining soon.",
    "",
    "**What gets sent (only if you say yes):** your goal, what's been tried, error " +
      "messages, a short session summary, and your tech stack.",
    "**Never sent:** your source files, the full conversation, environment variables, " +
      "or secrets — redaction runs on your machine before anything leaves it.",
    "",
    `Requests auto-delete after 30 days, and the response includes a private deletion ` +
      `link. Privacy policy: ${privacyUrl()}`,
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
