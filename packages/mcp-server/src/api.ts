import {
  redactObject,
  type RedactionSummary,
  type ThreadMessage,
} from "@get-an-expert/core";
import { apiBaseUrl, CONSENT_TEXT_VERSION, getInstallId } from "./config";
import {
  clearActiveThread,
  saveActiveThread,
  type ActiveThread,
} from "./thread";

export interface ExpertHelpInput {
  tool: string;
  goal: string;
  whatWasTried: string[];
  errorMessages: string[];
  conversationSummary: string;
  techStack: string[];
  expertiseArea: string;
  messagesStuckCount?: number;
}

export interface RedactedPayload {
  payload: ExpertHelpInput;
  clientRedactions: RedactionSummary[];
}

export type SubmitResult =
  | { ok: true; message: string }
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
const REQUEST_TIMEOUT_MS = 30_000;

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
    data?: { message?: string; requestId?: string; threadToken?: string };
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

  // Persist the thread credentials so this session (and future ones) can
  // keep talking to the expert.
  const { requestId, threadToken } = envelope.data;
  if (requestId && threadToken) {
    saveActiveThread({
      requestId,
      threadToken,
      apiBaseUrl: apiBaseUrl(),
      expertiseArea: payload.expertiseArea,
      lastSeenSeq: 0,
      createdAt: consentedAt.toISOString(),
    });
  }
  return { ok: true, message: envelope.data.message };
}

/* ------------------------------------------------------------------ */
/* Thread messaging                                                    */
/* ------------------------------------------------------------------ */

export interface ThreadProgress {
  whatWasTried: string[];
  errorMessages: string[];
}

export interface ThreadUpdates {
  status: string;
  expertName: string | null;
  messages: ThreadMessage[];
}

export type ThreadCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; gone?: boolean };

const NETWORK_ERROR =
  "The Get An Expert API could not be reached — nothing was lost, try again in a minute.";

function threadUrl(thread: ActiveThread): string {
  return `${thread.apiBaseUrl}/api/v1/requests/${thread.requestId}/messages`;
}

async function threadFetch<T>(
  thread: ActiveThread,
  init: RequestInit & { url: string },
): Promise<ThreadCallResult<T>> {
  let response: Response;
  try {
    response = await fetch(init.url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${thread.threadToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  let envelope: { success?: boolean; data?: T; error?: string };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    return {
      ok: false,
      error: `The Get An Expert API returned an unexpected response (HTTP ${response.status}).`,
    };
  }
  if (response.status === 404) {
    // Thread deleted or expired server-side: stop resuming it locally.
    clearActiveThread();
    return {
      ok: false,
      gone: true,
      error:
        "This expert thread no longer exists — it was deleted or hit its 30-day expiry. Start a fresh request if you still need help.",
    };
  }
  if (!response.ok || !envelope.success || envelope.data === undefined) {
    return {
      ok: false,
      error:
        envelope.error ??
        `The Get An Expert API returned HTTP ${response.status}. Try again shortly.`,
    };
  }
  return { ok: true, value: envelope.data };
}

/**
 * Sends a user message (and optional progress update) on the thread.
 * Everything passes local redaction first.
 */
export async function postThreadMessage(
  thread: ActiveThread,
  text: string,
  progress: ThreadProgress,
): Promise<ThreadCallResult<{ seq: number; status: string }>> {
  const hasProgress =
    progress.whatWasTried.length > 0 || progress.errorMessages.length > 0;
  const { value } = redactObject({
    text,
    progress: hasProgress ? progress : undefined,
  });
  const clean = value as { text: string; progress?: ThreadProgress };
  return threadFetch(thread, {
    url: threadUrl(thread),
    method: "POST",
    body: JSON.stringify(clean),
  });
}

/** New thread messages the user hasn't seen yet. */
export async function fetchThreadUpdates(
  thread: ActiveThread,
): Promise<ThreadCallResult<ThreadUpdates>> {
  return threadFetch(thread, {
    url: `${threadUrl(thread)}?after=${thread.lastSeenSeq}`,
    method: "GET",
  });
}
