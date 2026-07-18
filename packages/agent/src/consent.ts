import {
  ErrorCode,
  McpError,
  type ClientCapabilities,
  type ElicitRequestFormParams,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Grant } from "./permissions";

/** What the user approved inline: the revocable scopes, plus the one-time
 * consent to share this conversation as context (not part of the Grant —
 * it's a disclosure decision, not a revocable scope). */
export interface ScopeConsent {
  grant: Grant;
  shareTranscript: boolean;
}

/**
 * How scope consent was resolved:
 * - "unsupported": the host doesn't advertise MCP elicitation — or advertises
 *   it but rejects the call as method-not-found. Not a decision by anyone —
 *   the caller should fall back to a plain-language confirmation instead of
 *   failing.
 * - "failed": the host advertised elicitation but the call itself threw.
 *   Transient; distinct from a decline so the user knows to just retry.
 * - "dismissed": the prompt came back without a human answer — a cancel
 *   (form dismissed, or auto-cancelled by a host that never rendered it),
 *   or a decline faster than a human could have read the form. The caller
 *   should fall back to a plain-language confirmation that offers an
 *   explicit way to decline.
 * - "declined": the user was asked (via elicitation) and said no, or
 *   approved zero scopes.
 * - "granted": the user approved at least one scope.
 */
export type ElicitOutcome =
  | { kind: "unsupported" }
  | { kind: "failed" }
  | { kind: "dismissed" }
  | { kind: "declined" }
  | { kind: "granted"; consent: ScopeConsent };

/**
 * Fastest a human could plausibly read the one-line approval prompt and decline
 * it. Hosts that advertise elicitation but never render the prompt (e.g. the
 * Claude Code desktop GUI) auto-answer in milliseconds; treating those as real
 * declines made requests fail closed with no prompt ever shown. Err high: a
 * wrong "dismissed" costs one polite re-ask in chat, a wrong "declined" makes
 * expert help unusable on that host. Only non-accept answers are time-gated: a
 * host forging accepts could equally forge the chat fallback, so gating accepts
 * would add friction without adding safety.
 */
export const MIN_HUMAN_DECLINE_MS = 2000;

/**
 * The locked, truthful one-line consent statement, shown wherever approval is
 * asked for (the inline prompt and the plain-language fallback) so both speak in
 * one voice. Names the scopes in brackets; never says "sandboxed" or
 * "on your machine".
 */
function primaryConsentLine(dir: string): string {
  return `An expert can take context and help in ${dir} (files, terminal, browser).`;
}

/** Build a "granted" outcome, attaching the browser port only when browser was
 * approved. Shared by the one-tap approve and the per-scope choose paths. */
function grantOutcome(
  scopes: { files: boolean; terminal: boolean; browser: boolean },
  shareTranscript: boolean,
  port: number,
): ElicitOutcome {
  const grant: Grant = {
    files: scopes.files,
    terminal: scopes.terminal,
    browser: scopes.browser,
  };
  if (scopes.browser) grant.browserPort = port;
  return { kind: "granted", consent: { grant, shareTranscript } };
}

/**
 * Resolve scope consent via native MCP elicitation, when the host supports
 * it. Capabilities and the elicit call are passed in rather than read from
 * a live server, so the full decision tree is testable without a transport.
 */
export async function resolveScopeElicitation(input: {
  dir: string;
  port: number;
  capabilities: ClientCapabilities | undefined;
  elicit: (params: ElicitRequestFormParams) => Promise<ElicitResult>;
  /** Clock for the human-decline heuristic; injectable for tests. Defaults
   * to performance.now (monotonic) so a wall-clock jump during the prompt
   * can't misclassify an auto-decline as a human one. */
  now?: () => number;
}): Promise<ElicitOutcome> {
  if (!input.capabilities?.elicitation) {
    return { kind: "unsupported" };
  }
  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  try {
    // Primary prompt: ONE calm decision with "approve" preselected, not four
    // checkboxes. "choose" opens a second per-scope prompt so a user can still
    // be selective; "decline" says no.
    const result = await input.elicit({
      message: `${primaryConsentLine(input.dir)} Consent based only, logged live, revocable anytime.`,
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "Approve expert access?",
            description: `Files, terminal, and browser (localhost:${input.port}) in ${input.dir}.`,
            oneOf: [
              { const: "approve", title: "Yes, approve all three" },
              { const: "choose", title: "Let me choose which" },
              { const: "decline", title: "No, not now" },
            ],
            default: "approve",
          },
        },
        required: ["decision"],
      },
    });
    if (result.action === "cancel") return { kind: "dismissed" };
    if (result.action === "decline") {
      // Only non-accept answers are time-gated: a host that never renders the
      // prompt auto-answers in milliseconds, which we treat as "dismissed" so
      // the chat fallback still runs rather than failing closed.
      return now() - startedAt < MIN_HUMAN_DECLINE_MS
        ? { kind: "dismissed" }
        : { kind: "declined" };
    }
    if (result.action !== "accept" || !result.content) return { kind: "declined" };
    const decision = result.content.decision;
    if (decision === "decline") return { kind: "declined" };
    if (decision === "approve") {
      // One tap grants all three scopes and shares the conversation as context.
      return grantOutcome({ files: true, terminal: true, browser: true }, true, input.port);
    }
    if (decision === "choose") {
      // Second elicitation: the existing per-scope booleans, each defaulting
      // true, so a selective user still lands on exactly what they pick. The
      // host already rendered the first prompt, so no time-gate is needed here.
      const detail = await input.elicit({
        message: `Approve exactly what an expert can do in ${input.dir}. Anything you leave off stays off.`,
        requestedSchema: {
          type: "object",
          properties: {
            files: { type: "boolean", title: "Read & edit files", default: true },
            terminal: { type: "boolean", title: "Run terminal commands", default: true },
            browser: {
              type: "boolean",
              title: `View browser (localhost:${input.port})`,
              default: true,
            },
            conversation: {
              type: "boolean",
              title: "Share this conversation as context",
              default: true,
            },
          },
          required: ["files", "terminal", "browser", "conversation"],
        },
      });
      if (detail.action === "cancel") return { kind: "dismissed" };
      if (detail.action === "decline") return { kind: "declined" };
      if (detail.action !== "accept" || !detail.content) return { kind: "declined" };
      const files = detail.content.files === true;
      const terminal = detail.content.terminal === true;
      const browser = detail.content.browser === true;
      if (!files && !terminal && !browser) return { kind: "declined" };
      return grantOutcome(
        { files, terminal, browser },
        detail.content.conversation === true,
        input.port,
      );
    }
    // Unknown/absent decision — fail closed rather than granting.
    return { kind: "declined" };
  } catch (err) {
    if (err instanceof McpError && err.code === ErrorCode.MethodNotFound) {
      return { kind: "unsupported" };
    }
    // The SDK refuses locally with a plain Error when the client's declared
    // elicitation capability lacks the mode we need (e.g. advertises url but
    // not form): "Client does not support form elicitation." Same meaning as
    // never advertising it. If the SDK ever rewords this, we just fall back
    // to "failed" — no worse than before.
    if (err instanceof Error && /does not support .*elicitation/i.test(err.message)) {
      return { kind: "unsupported" };
    }
    return { kind: "failed" };
  }
}

/**
 * Plain-language scope description for hosts where the inline prompt isn't
 * usable — "unsupported" (host doesn't offer one) or "dismissed" (the prompt
 * came back unanswered, e.g. auto-cancelled by a host that never rendered
 * it, or closed by the user — so that variant offers an explicit way out).
 * The assistant relays this verbatim and waits for the user's explicit reply
 * before calling confirm_expert_scopes.
 */
/**
 * The five standing assurances, in one voice, shown alongside the plain-language
 * approval. Every line is literally true against the code and the operational
 * agreement; none uses "sandboxed", "on your machine", or an em dash.
 */
const CONSENT_ASSURANCES: readonly string[] = [
  "Consent based only. Nothing is accessed or shared until you approve, and you can revoke any part instantly.",
  "You see everything, live. Every file, command, and page is in a running log, for your safety.",
  "Private by design. Data flows straight to the expert over an encrypted peer to peer tunnel. Our relay never sees your files, terminal, or browser.",
  "Secrets stay yours. We do not open the files your project keeps private, and secrets are stripped from the shared context.",
  "Covered by agreement. Every expert works under a signed confidentiality agreement, so your data and your clients' data stay protected.",
];

export function buildScopesMessage(
  dir: string,
  port: number,
  reason: "unsupported" | "dismissed" = "unsupported",
): string {
  const scopeLine = `${primaryConsentLine(dir)} The browser scope is localhost:${port}.`;
  const lead =
    reason === "dismissed"
      ? `The approval prompt closed without an answer (on some clients it never ` +
        `appears). ${scopeLine} If you meant to say no, that is fine.`
      : `Your client cannot show an inline approval prompt, so approve here in chat. ${scopeLine}`;
  const assurances = CONSENT_ASSURANCES.map((line) => `- ${line}`).join("\n");
  const close =
    reason === "dismissed"
      ? "Reply yes to approve, tell me which parts, or just say no."
      : "Reply yes to approve, or tell me which parts.";
  return `${lead}\n\n${assurances}\n\n${close}`;
}

/** Agent-directed: relay buildScopesMessage verbatim, wait for the user's
 * explicit reply, then call confirm_expert_scopes with what they approved. */
export const SCOPES_CONFIRM_GUIDANCE: string =
  "Note for the assistant: relay the message above to the user verbatim and " +
  "wait for their explicit reply. Do not assume consent or invent an answer. " +
  "Once they respond, call confirm_expert_scopes with exactly the scopes they " +
  "approved (default anything unaddressed to false).";

export function buildDeclinedMessage(): string {
  return "No access was granted, so the request was cancelled. Nothing is accessed or shared without your approval.";
}

export function buildElicitationFailedMessage(): string {
  return "The approval prompt could not be completed, so nothing was granted. Ask for expert help again to retry.";
}

/**
 * How scope consent was obtained. Recorded in the audit log so a host-verified
 * elicitation approval (the client's own UI returned the checkboxes) can be
 * told apart from a model-mediated chat reply (the assistant supplied the
 * booleans) during incident review — the latter is a weaker trust model.
 */
export type ConsentMechanism = "elicitation" | "chat-fallback";

/**
 * Whether a pending plain-language confirmation may be finalized against the
 * current session. Requires a pending confirmation, an active (non-ended,
 * non-idle) session, and — critically — that the pending confirmation belongs
 * to THAT session (matching sessionId). Keying to the session id means a stale
 * confirmation left over from a previous session can never grant access in a
 * new one, rather than relying on the state check alone. Fails closed.
 */
export function canFinalizePending(
  pending: { sessionId: string | undefined } | undefined,
  session: { state: string; sessionId: string | undefined } | undefined,
): boolean {
  if (!pending || !session) return false;
  if (session.state === "ended" || session.state === "idle") return false;
  return pending.sessionId !== undefined && pending.sessionId === session.sessionId;
}
