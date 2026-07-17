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
 * Fastest a human could plausibly read the four-checkbox approval form and
 * decline it. Hosts that advertise elicitation but never render the form
 * (e.g. the Claude Code desktop GUI) auto-answer in milliseconds; treating
 * those as real declines made requests fail closed with no prompt ever shown.
 * Err high: a wrong "dismissed" costs one polite re-ask in chat, a wrong
 * "declined" makes expert help unusable on that host. Only non-accept answers
 * are time-gated — a host forging accepts could equally forge the chat
 * fallback, so gating accepts would add friction without adding safety.
 */
export const MIN_HUMAN_DECLINE_MS = 2000;

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
    const result = await input.elicit({
      message:
        `An expert wants to help, scoped to ${input.dir} — logged live, revocable anytime. Approve:`,
      requestedSchema: {
        type: "object",
        properties: {
          files: {
            type: "boolean",
            title: "Read & edit files",
            default: true,
          },
          terminal: {
            type: "boolean",
            title: "Run terminal commands",
            default: true,
          },
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
    if (result.action === "cancel") return { kind: "dismissed" };
    if (result.action === "decline") {
      return now() - startedAt < MIN_HUMAN_DECLINE_MS
        ? { kind: "dismissed" }
        : { kind: "declined" };
    }
    if (result.action !== "accept" || !result.content) return { kind: "declined" };
    const files = result.content.files === true;
    const terminal = result.content.terminal === true;
    const browser = result.content.browser === true;
    if (!files && !terminal && !browser) return { kind: "declined" };
    const grant: Grant = { files, terminal, browser };
    if (browser) grant.browserPort = input.port;
    return {
      kind: "granted",
      consent: { grant, shareTranscript: result.content.conversation === true },
    };
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
export function buildScopesMessage(
  dir: string,
  port: number,
  reason: "unsupported" | "dismissed" = "unsupported",
): string {
  const lead =
    reason === "dismissed"
      ? `An expert wants to help, scoped to ${dir}. The approval prompt was closed ` +
        `without an answer (on some clients it never actually appears), so tell me ` +
        `in plain language which of these you approve — nothing is granted until ` +
        `you say so, and if you meant to decline, just say no:`
      : `An expert wants to help, scoped to ${dir}. Your client can't show an inline ` +
        `approval prompt, so tell me in plain language which of these you approve — ` +
        `nothing is granted until you say so:`;
  return (
    `${lead}\n\n` +
    `- Files: read & edit files in ${dir}\n` +
    `- Terminal: run terminal commands\n` +
    `- Browser: view the browser at localhost:${port}\n\n` +
    `You can also say whether to share this conversation with the expert as ` +
    `context. Every scope is revocable anytime once granted.`
  );
}

/** Agent-directed: relay buildScopesMessage verbatim, wait for the user's
 * explicit reply, then call confirm_expert_scopes with what they approved. */
export const SCOPES_CONFIRM_GUIDANCE: string =
  "Note for the assistant: relay the message above to the user verbatim and " +
  "wait for their explicit reply. Do not assume consent or invent an answer. " +
  "Once they respond, call confirm_expert_scopes with exactly the scopes they " +
  "approved (default anything unaddressed to false).";

export function buildDeclinedMessage(): string {
  return "No access was granted, so the request was cancelled. Nothing runs on your machine without your approval.";
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
