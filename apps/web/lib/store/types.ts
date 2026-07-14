import type {
  ExpertRequestRecord,
  NewThreadMessage,
  ThreadMessage,
} from "@get-an-expert/core";

export interface StoredRequest extends ExpertRequestRecord {
  /** SHA-256 hash of the deletion token; the raw token is never stored. */
  deleteTokenHash: string;
  /** SHA-256 hash of the thread token; the raw token is never stored. */
  threadTokenHash: string;
}

export interface Store {
  create(record: StoredRequest, ttlSeconds: number): Promise<void>;
  get(id: string): Promise<StoredRequest | null>;
  /** Replaces the stored record wholesale (records are immutable values). */
  put(record: StoredRequest, ttlSeconds: number): Promise<void>;
  /** Newest first. */
  list(limit: number): Promise<StoredRequest[]>;
  /** Removes the record AND its thread messages. */
  delete(id: string): Promise<boolean>;
  /**
   * Appends to the request's thread and returns the assigned 1-based seq.
   * Append-only by design: no read-modify-write races between the user and
   * the expert posting concurrently. `ttlSeconds` bounds the thread's
   * lifetime the same way the record's TTL does.
   */
  appendMessage(
    id: string,
    message: NewThreadMessage,
    ttlSeconds: number,
  ): Promise<number>;
  /** Thread messages with seq > afterSeq, in order. */
  listMessages(id: string, afterSeq: number): Promise<ThreadMessage[]>;
  /** O(1) message count, for enforcing the per-thread cap before appending. */
  countMessages(id: string): Promise<number>;
  /**
   * Fixed-window counter for rate limiting. Increments the counter for the
   * current window and returns the new count. The key should already encode
   * the scope (ip/install id); the window start is appended internally.
   */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
}

export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
