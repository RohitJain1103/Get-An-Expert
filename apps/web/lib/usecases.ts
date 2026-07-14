import {
  redactObject,
  type ExpertRequestPayload,
  type ExpertRequestStatus,
  type ThreadMessage,
} from "@get-an-expert/core";
import {
  hashToken,
  newDeleteToken,
  newRequestId,
  newThreadToken,
  safeEqual,
} from "./id";
import type { ExpertRequestInput, ThreadProgressInput } from "./schema";
import type { Store, StoredRequest } from "./store/types";
import { THIRTY_DAYS_SECONDS } from "./store/types";

export interface CreateExpertRequestResult {
  requestId: string;
  deleteToken: string;
  deleteUrl: string;
  /** Authenticates thread messaging for this request; returned once. */
  threadToken: string;
  status: "new";
  /** Preformatted markdown the MCP client relays to the user verbatim. */
  message: string;
}

/** Shown with every message so retention + deletion rights travel with it. */
export const RETENTION_LINE = "Your request auto-deletes in 30 days.";

export async function createExpertRequest(opts: {
  store: Store;
  input: ExpertRequestInput;
  baseUrl: string;
  now?: Date;
}): Promise<CreateExpertRequestResult> {
  const { store, input, baseUrl } = opts;
  const now = opts.now ?? new Date();

  // Re-redact server-side even though the client already did: defense in
  // depth against outdated clients or patterns added after a client shipped.
  const { consent, ...rawPayload } = input;
  const { value, redactions } = redactObject(rawPayload);
  const payload = value as ExpertRequestPayload;

  const id = newRequestId();
  const deleteToken = newDeleteToken();
  const threadToken = newThreadToken();
  const record: StoredRequest = {
    id,
    createdAt: now.toISOString(),
    status: "new",
    payload,
    serverRedactions: redactions,
    consent,
    deleteTokenHash: hashToken(deleteToken),
    threadTokenHash: hashToken(threadToken),
    lastActivityAt: now.toISOString(),
  };
  await store.create(record, THIRTY_DAYS_SECONDS);
  const deleteUrl = `${baseUrl}/delete/${id}?token=${deleteToken}`;

  return {
    requestId: id,
    deleteToken,
    deleteUrl,
    threadToken,
    status: "new",
    message: threadOpenedMessage(payload.expertiseArea, id, deleteUrl),
  };
}

function threadOpenedMessage(
  expertiseArea: string,
  id: string,
  deleteUrl: string,
): string {
  return [
    "✅ **Request received — your expert thread is open.**",
    "",
    `A human expert in ${expertiseArea} will pick this up, and their reply ` +
      `lands right here in your session. You can talk to the expert anytime ` +
      `from this chat: say "tell the expert …" to send a message, or "check ` +
      `my expert thread" to look for replies (request id: ${id}).`,
    "",
    `_${RETENTION_LINE} Delete it anytime: ${deleteUrl}_`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Thread: user side (authenticated by the per-request thread token)   */
/* ------------------------------------------------------------------ */

export type ThreadFailure = "not_found" | "forbidden";

/**
 * Hard ceiling on messages per thread. Far above any real conversation
 * (write limits allow 60/hour), it bounds storage and keeps full-thread
 * reads cheap enough to skip pagination.
 */
export const MAX_THREAD_MESSAGES = 400;

export interface ThreadView {
  status: ExpertRequestStatus;
  expertName?: string;
  messages: ThreadMessage[];
}

/**
 * Exported so routes can authenticate BEFORE consuming any per-thread
 * budget (rate limits, quotas) — never the other way around.
 */
export async function verifyThreadToken(
  store: Store,
  id: string,
  token: string,
): Promise<StoredRequest | ThreadFailure> {
  const record = await store.get(id);
  if (!record) return "not_found";
  if (!safeEqual(record.threadTokenHash, hashToken(token))) {
    return "forbidden";
  }
  return record;
}

function progressActivityText(progress: ThreadProgressInput): string {
  const parts: string[] = [];
  if (progress.whatWasTried.length > 0) {
    parts.push(`tried: ${progress.whatWasTried.join(" · ")}`);
  }
  if (progress.errorMessages.length > 0) {
    parts.push(`new errors:\n${progress.errorMessages.join("\n---\n")}`);
  }
  return `Progress update — ${parts.join("\n")}`;
}

/**
 * Appends a user message (and optional consented progress update) to the
 * thread. A message on a solved thread reopens it.
 */
export async function postUserMessage(opts: {
  store: Store;
  id: string;
  token: string;
  text: string;
  progress?: ThreadProgressInput;
  now?: Date;
}): Promise<
  | { ok: true; seq: number; status: ExpertRequestStatus }
  | { ok: false; reason: ThreadFailure | "thread_full" }
> {
  const { store, id, token } = opts;
  const now = opts.now ?? new Date();
  const record = await verifyThreadToken(store, id, token);
  if (typeof record === "string") return { ok: false, reason: record };
  if ((await store.countMessages(id)) >= MAX_THREAD_MESSAGES) {
    return { ok: false, reason: "thread_full" };
  }

  // Same defense-in-depth redaction as the original payload.
  const { value } = redactObject({ text: opts.text, progress: opts.progress });
  const clean = value as { text: string; progress?: ThreadProgressInput };

  const at = now.toISOString();
  const seq = await store.appendMessage(
    id,
    { from: "user", kind: "message", text: clean.text, at },
    THIRTY_DAYS_SECONDS,
  );
  const progress = clean.progress;
  const hasProgress =
    progress !== undefined &&
    (progress.whatWasTried.length > 0 || progress.errorMessages.length > 0);
  if (hasProgress) {
    await store.appendMessage(
      id,
      { from: "user", kind: "activity", text: progressActivityText(progress), at },
      THIRTY_DAYS_SECONDS,
    );
  }

  // A message on a solved thread reopens it for the expert. Re-read right
  // before writing: record updates are last-writer-wins, and the fresh read
  // shrinks the race window against a concurrent expert action to ~zero.
  // (Messages themselves are append-only — a race can never lose one.)
  const fresh = (await store.get(id)) ?? record;
  const status: ExpertRequestStatus =
    fresh.status === "solved" ? "live" : fresh.status;
  await store.put(
    { ...fresh, status, lastActivityAt: at },
    THIRTY_DAYS_SECONDS,
  );
  return { ok: true, seq, status };
}

/** Thread messages after `afterSeq`, plus current status — for polling. */
export async function listThreadMessages(opts: {
  store: Store;
  id: string;
  token: string;
  afterSeq: number;
}): Promise<
  | ({ ok: true } & ThreadView)
  | { ok: false; reason: ThreadFailure }
> {
  const { store, id, token, afterSeq } = opts;
  const record = await verifyThreadToken(store, id, token);
  if (typeof record === "string") return { ok: false, reason: record };
  const messages = await store.listMessages(id, afterSeq);
  return {
    ok: true,
    status: record.status,
    expertName: record.expertName,
    messages,
  };
}

/* ------------------------------------------------------------------ */
/* Thread: expert side (dashboard-authenticated, no thread token)      */
/* ------------------------------------------------------------------ */

/** Marks the thread claimed; the user sees "<name> joined your thread". */
export async function claimThread(
  store: Store,
  id: string,
  expertName: string,
  now = new Date(),
): Promise<boolean> {
  const record = await store.get(id);
  if (!record) return false;
  // The name reaches the user's session verbatim — redact it like any
  // other expert-supplied text (a pasted token in this field must not leak).
  const { value } = redactObject({ name: expertName });
  const cleanName = (value as { name: string }).name;
  const at = now.toISOString();
  await store.appendMessage(
    id,
    { from: "expert", kind: "activity", text: `${cleanName} joined the thread`, at },
    THIRTY_DAYS_SECONDS,
  );
  // Fresh read before the last-writer-wins put — see postUserMessage.
  const fresh = (await store.get(id)) ?? record;
  await store.put(
    {
      ...fresh,
      status: "live",
      expertName: fresh.expertName ?? cleanName,
      lastActivityAt: at,
    },
    THIRTY_DAYS_SECONDS,
  );
  return true;
}

export async function postExpertMessage(
  store: Store,
  id: string,
  text: string,
  now = new Date(),
): Promise<{ ok: boolean; seq?: number }> {
  const record = await store.get(id);
  if (!record) return { ok: false };
  if ((await store.countMessages(id)) >= MAX_THREAD_MESSAGES) {
    return { ok: false };
  }
  // Experts can paste secrets by accident too.
  const { value } = redactObject({ text });
  const at = now.toISOString();
  const seq = await store.appendMessage(
    id,
    { from: "expert", kind: "message", text: (value as { text: string }).text, at },
    THIRTY_DAYS_SECONDS,
  );
  const fresh = (await store.get(id)) ?? record;
  await store.put(
    { ...fresh, status: "live", lastActivityAt: at },
    THIRTY_DAYS_SECONDS,
  );
  return { ok: true, seq };
}

export async function markThreadSolved(
  store: Store,
  id: string,
  now = new Date(),
): Promise<boolean> {
  const record = await store.get(id);
  if (!record) return false;
  const at = now.toISOString();
  await store.appendMessage(
    id,
    {
      from: "expert",
      kind: "activity",
      text: "Thread marked solved — message again anytime to reopen it",
      at,
    },
    THIRTY_DAYS_SECONDS,
  );
  const fresh = (await store.get(id)) ?? record;
  await store.put(
    { ...fresh, status: "solved", lastActivityAt: at },
    THIRTY_DAYS_SECONDS,
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Deletion + listing (unchanged semantics)                            */
/* ------------------------------------------------------------------ */

export async function deleteExpertRequest(
  store: Store,
  id: string,
  token: string,
): Promise<"deleted" | "not_found" | "forbidden"> {
  const record = await store.get(id);
  if (!record) return "not_found";
  if (!safeEqual(record.deleteTokenHash, hashToken(token))) return "forbidden";
  await store.delete(id);
  return "deleted";
}

/** Dashboard listing without the token hashes. */
export async function listExpertRequests(
  store: Store,
  limit: number,
): Promise<Omit<StoredRequest, "deleteTokenHash" | "threadTokenHash">[]> {
  const records = await store.list(limit);
  return records.map(
    ({ deleteTokenHash: _d, threadTokenHash: _t, ...rest }) => rest,
  );
}
