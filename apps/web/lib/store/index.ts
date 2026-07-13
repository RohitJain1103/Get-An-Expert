import { env } from "../env";
import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { Store } from "./types";

let store: Store | null = null;

/**
 * Returns the process-wide store. Redis when Upstash env vars are present,
 * otherwise an in-memory store (dev only — logs a warning once).
 */
export function getStore(): Store {
  if (store) return store;
  const url = env.upstashUrl();
  const token = env.upstashToken();
  if (url && token) {
    store = RedisStore.fromEnv(url, token);
  } else {
    console.warn(
      "[get-an-expert] No Redis configured — using in-memory store. " +
        "Data will not survive restarts. Set UPSTASH_REDIS_REST_URL/TOKEN.",
    );
    store = new MemoryStore();
  }
  return store;
}

/** Test seam. */
export function setStore(next: Store | null): void {
  store = next;
}
