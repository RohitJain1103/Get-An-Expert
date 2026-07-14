import { redactObject, type ExpertRequestPayload } from "@get-an-expert/core";
import {
  hashToken,
  newChatToken,
  newDeleteToken,
  newRequestId,
  safeEqual,
} from "./id";
import type { ExpertRequestInput } from "./schema";
import type { Store, StoredRequest } from "./store/types";
import { THIRTY_DAYS_SECONDS } from "./store/types";

export interface CreateExpertRequestResult {
  requestId: string;
  deleteToken: string;
  /** Chat access token — returned once, only its hash is stored. */
  chatToken: string;
  deleteUrl: string;
  status: "new";
  /** Preformatted markdown the MCP client relays to the user verbatim. */
  message: string;
}

/** Shown with every message so retention + deletion rights travel with it. */
export const RETENTION_LINE = "Your request auto-deletes in 30 days.";

/**
 * Stores the request and mints its tokens. No AI runs here: a human expert
 * meets the user in the live chat (the MCP side opens Terminal A and appends
 * the join instructions to this message).
 */
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
  const chatToken = newChatToken();
  const record: StoredRequest = {
    id,
    createdAt: now.toISOString(),
    status: "new",
    payload,
    serverRedactions: redactions,
    consent,
    deleteTokenHash: hashToken(deleteToken),
    chatTokenHash: hashToken(chatToken),
    chat: { status: "active", startedAt: now.toISOString() },
    lastActivityAt: now.toISOString(),
  };
  await store.create(record, THIRTY_DAYS_SECONDS);
  const deleteUrl = `${baseUrl}/delete/${id}?token=${deleteToken}`;

  return {
    requestId: id,
    deleteToken,
    chatToken,
    deleteUrl,
    status: "new",
    message: requestReceivedMessage(payload.expertiseArea, id, deleteUrl),
  };
}

function requestReceivedMessage(
  expertiseArea: string,
  id: string,
  deleteUrl: string,
): string {
  return [
    "✅ **Request received — your live expert chat is open.**",
    "",
    `A human expert in ${expertiseArea} will join you in the chat terminal ` +
      `and you can talk there directly, like texting (request id: ${id}).`,
    "",
    `_${RETENTION_LINE} Delete it anytime: ${deleteUrl}_`,
  ].join("\n");
}

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
): Promise<Omit<StoredRequest, "deleteTokenHash" | "chatTokenHash">[]> {
  const records = await store.list(limit);
  return records.map(
    ({ deleteTokenHash: _d, chatTokenHash: _c, ...rest }) => rest,
  );
}
