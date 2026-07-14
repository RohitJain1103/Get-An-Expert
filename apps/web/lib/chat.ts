import {
  redactText,
  type ChatMessage,
  type ChatRole,
  type ChatState,
} from "@get-an-expert/core";
import { hashToken, safeEqual } from "./id";
import type { Store, StoredRequest } from "./store/types";
import { THIRTY_DAYS_SECONDS } from "./store/types";

export type PostChatResult =
  | { outcome: "ok"; seq: number }
  | { outcome: "ended" };

/** Constant-time check of a presented chat token against the stored hash. */
export function verifyChatToken(record: StoredRequest, token: string): boolean {
  if (!record.chatTokenHash || !token) return false;
  return safeEqual(record.chatTokenHash, hashToken(token));
}

/**
 * Appends one chat line. Refuses (outcome "ended") unless the chat is
 * currently active — the server side of the hard stop. Every text passes the
 * server-side redactor: defense in depth, both directions (expert included).
 */
export async function postChatMessage(opts: {
  store: Store;
  record: StoredRequest;
  from: ChatRole;
  text: string;
  authorName?: string;
  now?: Date;
}): Promise<PostChatResult> {
  const { store, record, from, authorName } = opts;
  const now = opts.now ?? new Date();
  if (record.chat?.status !== "active") return { outcome: "ended" };

  // First expert message: record the join and emit a one-time join notice.
  if (from === "expert" && !record.chat.expertJoinedAt) {
    const joined: StoredRequest = {
      ...record,
      chat: {
        ...record.chat,
        expertJoinedAt: now.toISOString(),
        expertName: authorName,
      },
    };
    await store.put(joined, THIRTY_DAYS_SECONDS);
    await store.appendMessage(
      record.id,
      {
        at: now.toISOString(),
        from: "expert",
        kind: "system",
        text: `${authorName ?? "An expert"} joined the chat`,
      },
      THIRTY_DAYS_SECONDS,
    );
  }

  const seq = await store.appendMessage(
    record.id,
    {
      at: now.toISOString(),
      from,
      ...(authorName ? { authorName } : {}),
      kind: "message",
      text: redactText(opts.text).text,
    },
    THIRTY_DAYS_SECONDS,
  );
  return { outcome: "ok", seq };
}

export async function listChatMessages(
  store: Store,
  requestId: string,
  afterSeq: number,
): Promise<{ messages: ChatMessage[]; chat?: ChatState }> {
  const record = await store.get(requestId);
  const messages = await store.listMessages(requestId, afterSeq);
  return { messages, chat: record?.chat };
}

/**
 * Hard stop from either side. Idempotent: a second end keeps the first
 * ender's attribution. Appends a system notice so both clients can render
 * the ending inside the transcript.
 */
export async function endChatSession(opts: {
  store: Store;
  record: StoredRequest;
  by: ChatRole;
  now?: Date;
}): Promise<"ended" | "already_ended"> {
  const { store, record, by } = opts;
  const now = opts.now ?? new Date();
  if (!record.chat || record.chat.status === "ended") return "already_ended";

  const ended: StoredRequest = {
    ...record,
    chat: {
      ...record.chat,
      status: "ended",
      endedAt: now.toISOString(),
      endedBy: by,
    },
  };
  await store.put(ended, THIRTY_DAYS_SECONDS);
  await store.appendMessage(
    record.id,
    {
      at: now.toISOString(),
      from: by,
      kind: "system",
      text: "Chat ended. Nothing is shared anymore.",
    },
    THIRTY_DAYS_SECONDS,
  );
  return "ended";
}
