import {
  redactObject,
  type ExpertRequestPayload,
} from "@get-an-expert/core";
import { hashToken, newDeleteToken, newRequestId, safeEqual } from "./id";
import type { ExpertRequestInput } from "./schema";
import type { Store, StoredRequest } from "./store/types";
import { THIRTY_DAYS_SECONDS } from "./store/types";

export interface CreateExpertRequestResult {
  requestId: string;
  deleteToken: string;
  deleteUrl: string;
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
  const record: StoredRequest = {
    id,
    createdAt: now.toISOString(),
    status: "new",
    payload,
    serverRedactions: redactions,
    consent,
    deleteTokenHash: hashToken(deleteToken),
  };
  await store.create(record, THIRTY_DAYS_SECONDS);
  const deleteUrl = `${baseUrl}/delete/${id}?token=${deleteToken}`;

  return {
    requestId: id,
    deleteToken,
    deleteUrl,
    status: "new",
    message: receivedMessage(payload.expertiseArea, id, deleteUrl),
  };
}

function receivedMessage(
  expertiseArea: string,
  id: string,
  deleteUrl: string,
): string {
  return [
    "✅ **Request received — an expert will take it from here.**",
    "",
    `Your summary is now with Get An Expert. A human expert in ` +
      `${expertiseArea} will review it and send back a diagnosis plus the ` +
      `exact next steps (request id: ${id}).`,
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

/** Dashboard listing without the token hash. */
export async function listExpertRequests(
  store: Store,
  limit: number,
): Promise<Omit<StoredRequest, "deleteTokenHash">[]> {
  const records = await store.list(limit);
  return records.map(({ deleteTokenHash: _hash, ...rest }) => rest);
}
