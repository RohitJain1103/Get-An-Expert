import type { ExpertRequestRecord } from "@get-an-expert/core";

export interface StoredRequest extends ExpertRequestRecord {
  /** SHA-256 hash of the deletion token; the raw token is never stored. */
  deleteTokenHash: string;
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
   * Fixed-window counter for rate limiting. Increments the counter for the
   * current window and returns the new count. The key should already encode
   * the scope (ip/install id); the window start is appended internally.
   */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
}

export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
