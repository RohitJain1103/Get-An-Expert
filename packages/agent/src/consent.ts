import type {
  ClientCapabilities,
  ElicitRequestFormParams,
  ElicitResult,
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
 * - "unsupported": the host doesn't advertise MCP elicitation. Not a
 *   decision by anyone — the caller should fall back to a plain-language
 *   confirmation instead of failing.
 * - "failed": the host advertised elicitation but the call itself threw.
 *   Transient; distinct from a decline so the user knows to just retry.
 * - "declined": the user was asked (via elicitation) and said no, or
 *   approved zero scopes.
 * - "granted": the user approved at least one scope.
 */
export type ElicitOutcome =
  | { kind: "unsupported" }
  | { kind: "failed" }
  | { kind: "declined" }
  | { kind: "granted"; consent: ScopeConsent };

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
}): Promise<ElicitOutcome> {
  if (!input.capabilities?.elicitation) {
    return { kind: "unsupported" };
  }
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
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Plain-language scope description for hosts that don't support inline
 * elicitation. The assistant relays this verbatim and waits for the user's
 * explicit reply before calling confirm_expert_scopes.
 */
export function buildScopesMessage(dir: string, port: number): string {
  return (
    `An expert wants to help, scoped to ${dir}. Your client can't show an inline ` +
    `approval prompt, so tell me in plain language which of these you approve — ` +
    `nothing is granted until you say so:\n\n` +
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
