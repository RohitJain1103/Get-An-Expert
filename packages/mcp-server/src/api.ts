import { redactObject, type RedactionSummary } from "@get-an-expert/core";
import { apiBaseUrl, CONSENT_TEXT_VERSION, getInstallId } from "./config";

export interface ExpertHelpInput {
  tool: string;
  goal: string;
  whatWasTried: string[];
  errorMessages: string[];
  conversationSummary: string;
  techStack: string[];
  expertiseArea: string;
  messagesStuckCount?: number;
  /** Resolved by resolveRequesterName (@get-an-expert/core) before this is built. */
  requesterName?: string;
}

export interface RedactedPayload {
  payload: ExpertHelpInput;
  clientRedactions: RedactionSummary[];
}

export type SubmitResult =
  | {
      ok: true;
      message: string;
      /** Present when the server supports live expert chat (>= 0.2). */
      requestId?: string;
      chatToken?: string;
      chatJoinCommand?: string;
    }
  | { ok: false; error: string };

/**
 * Local redaction pass — runs on the user's machine BEFORE anything is
 * transmitted. Exported separately so it's unit-testable.
 */
export function buildRedactedPayload(input: ExpertHelpInput): RedactedPayload {
  const { value, redactions } = redactObject(input);
  return { payload: value as ExpertHelpInput, clientRedactions: redactions };
}

/** Submission is a quick store-and-confirm — no long-running work behind it. */
export const REQUEST_TIMEOUT_MS = 30_000;

export async function submitExpertRequest(
  input: ExpertHelpInput,
  consentedAt: Date,
): Promise<SubmitResult> {
  const { payload, clientRedactions } = buildRedactedPayload(input);

  const body = {
    ...payload,
    installId: getInstallId(),
    clientRedactions,
    consent: {
      agreed: true as const,
      textVersion: CONSENT_TEXT_VERSION,
      at: consentedAt.toISOString(),
    },
  };

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "the request timed out"
        : "the Get An Expert API could not be reached";
    return {
      ok: false,
      error: `Nothing to worry about, but ${reason}. Your data was not lost on our side because it never arrived — feel free to try once more in a minute.`,
    };
  }

  let envelope: {
    success?: boolean;
    data?: {
      message?: string;
      requestId?: string;
      chatToken?: string;
      chatJoinCommand?: string;
    };
    error?: string;
  };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    return {
      ok: false,
      error: `The Get An Expert API returned an unexpected response (HTTP ${response.status}). Try again shortly.`,
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      error:
        envelope.error ??
        "Request limit reached for now — try again in a little while.",
    };
  }
  if (!response.ok || !envelope.success || !envelope.data?.message) {
    return {
      ok: false,
      error:
        envelope.error ??
        `The Get An Expert API returned HTTP ${response.status}. Try again shortly.`,
    };
  }
  return {
    ok: true,
    message: envelope.data.message,
    requestId: envelope.data.requestId,
    chatToken: envelope.data.chatToken,
    chatJoinCommand: envelope.data.chatJoinCommand,
  };
}
