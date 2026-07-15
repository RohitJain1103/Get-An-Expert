import type {
  ChatMessage,
  ExpertRequestRecord,
  NewChatMessage,
} from "@get-an-expert/core";

export interface StoredRequest extends ExpertRequestRecord {
  /** SHA-256 hash of the deletion token; the raw token is never stored. */
  deleteTokenHash: string;
  /**
   * SHA-256 hash of the chat access token; the raw token is returned to the
   * client exactly once at creation. Optional: records created before the
   * chat feature have none (chat is simply unavailable for them).
   */
  chatTokenHash?: string;
}

export interface Store {
  create(record: StoredRequest, ttlSeconds: number): Promise<void>;
  get(id: string): Promise<StoredRequest | null>;
  /** Replaces the stored record wholesale (records are immutable values). */
  put(record: StoredRequest, ttlSeconds: number): Promise<void>;
  /** Newest first. */
  list(limit: number): Promise<StoredRequest[]>;
  delete(id: string): Promise<boolean>;
  /**
   * Appends one chat message to the request's ordered message list and
   * returns its 1-based seq. The list shares the request's retention window
   * and is removed by delete(). Callers must ensure the request exists.
   */
  appendMessage(
    requestId: string,
    message: NewChatMessage,
    ttlSeconds: number,
  ): Promise<number>;
  /** Messages with seq > afterSeq, oldest first, seq attached. */
  listMessages(requestId: string, afterSeq: number): Promise<ChatMessage[]>;
  /**
   * Fixed-window counter for rate limiting. Increments the counter for the
   * current window and returns the new count. The key should already encode
   * the scope (ip/install id); the window start is appended internally.
   */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
}

export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
