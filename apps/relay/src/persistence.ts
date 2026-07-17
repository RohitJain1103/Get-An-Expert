import { Redis } from "@upstash/redis";
import { NO_PERMISSIONS, type ContextManifest, type Permissions } from "./protocol";
import type { Delivery, Session } from "./sessions";

/**
 * Durable session persistence for the relay.
 *
 * The live `SessionStore` is the hot path — WebRTC signaling and socket routing
 * can only work against in-memory sockets. This layer mirrors the *durable
 * metadata* of a request (who needs help, its resume-token hash, granted
 * scopes) so the queue survives a relay restart: on boot the relay rehydrates
 * these as offline entries, and a reconnecting agent flips them back online.
 *
 * Deliberately NOT persisted: chat history and the activity log. The inbox is
 * about a request existing and being claimable again, not replaying history.
 */

/** The subset of a Session that is written to durable storage. */
export interface PersistedSession {
  id: string;
  customerName: string;
  projectDir: string;
  issue?: string;
  issueEditedAt?: number;
  issueEditedBy?: "customer" | "expert";
  contextManifest?: ContextManifest;
  status: Session["status"];
  expertName?: string;
  expertId?: string;
  delivery?: Delivery;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  permissions: Permissions;
  customerToken: string;
  resumeTokenHash: string;
}

export interface SessionPersistence {
  /** Upsert a session's durable metadata. */
  save(session: Session): Promise<void>;
  /** Remove a session (explicit end / expiry). */
  remove(id: string): Promise<void>;
  /** Load every stored session, for rehydration on boot. */
  loadAll(): Promise<Session[]>;
}

/** Project a live Session down to its durable fields. */
export function toPersisted(session: Session): PersistedSession {
  return {
    id: session.id,
    customerName: session.customerName,
    projectDir: session.projectDir,
    issue: session.issue,
    issueEditedAt: session.issueEditedAt,
    issueEditedBy: session.issueEditedBy,
    contextManifest: session.contextManifest,
    status: session.status,
    expertName: session.expertName,
    expertId: session.expertId,
    // Persist the delivery so the card / accepted screen survives a restart,
    // but never the rating: it is a fire-once event to the expert, not a stored
    // or aggregated outcome (decision 2026-07-17).
    delivery: session.delivery
      ? {
          summary: session.delivery.summary,
          at: session.delivery.at,
          respondedAt: session.delivery.respondedAt,
          accepted: session.delivery.accepted,
        }
      : undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    claimedAt: session.claimedAt,
    permissions: session.permissions,
    customerToken: session.customerToken,
    resumeTokenHash: session.resumeTokenHash,
  };
}

/**
 * Rebuild a Session from stored metadata. Always comes back waiting + offline
 * with no expert: after a relay restart the WebRTC peer and expert connection
 * are gone, so a previously-claimed request must be re-claimed once its
 * customer reconnects. Chat/activity are not restored.
 */
export function fromPersisted(p: PersistedSession): Session {
  return {
    id: p.id,
    customerName: p.customerName,
    projectDir: p.projectDir,
    issue: p.issue,
    // The issue text and its edit metadata survive a restart: they describe the
    // request itself, not the (torn-down) expert connection.
    issueEditedAt: p.issueEditedAt,
    issueEditedBy: p.issueEditedBy,
    // The manifest describes CONTEXT.md, which the reconnecting agent still
    // holds, so it survives the restart too (resume carries no manifest).
    contextManifest: p.contextManifest,
    // The delivery record describes work that was done and the customer's
    // response to it, so it survives a restart and restores the delivered card
    // or accepted screen when the customer reconnects.
    delivery: p.delivery,
    status: "waiting",
    online: false,
    expertName: undefined,
    // Cleared alongside expertName: a hydrated session is always demoted to
    // waiting and must be re-claimed, so it carries no expert identity.
    expertId: undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    claimedAt: undefined,
    permissions: p.permissions ?? { ...NO_PERMISSIONS },
    activity: [],
    customerToken: p.customerToken,
    resumeTokenHash: p.resumeTokenHash,
    chat: [],
  };
}

/**
 * No-op persistence: the default. Keeps local dev and the existing tests
 * zero-config, and means "survive disconnects / auto-resume / offline queue /
 * expiry" all work without Redis — only *relay-restart* survival needs it.
 */
export class MemoryPersistence implements SessionPersistence {
  async save(_session: Session): Promise<void> {}
  async remove(_id: string): Promise<void> {}
  async loadAll(): Promise<Session[]> {
    return [];
  }
}

/** The slice of the Upstash client this module uses (so it can be faked). */
export interface RedisLike {
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  zadd(
    key: string,
    member: { score: number; member: string },
  ): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
}

const KEY_PREFIX = "gae:relay:session:";
const INDEX_KEY = "gae:relay:sessions";

/**
 * Redis-backed persistence via the Upstash REST client (pure HTTP — no native
 * modules, so the relay image stays dependency-light). Mirrors the storage
 * convention in `apps/web/lib/store/redis.ts`: `gae:relay:session:<id>` records
 * with a TTL, plus a `gae:relay:sessions` sorted set indexing them by createdAt.
 */
export class RedisPersistence implements SessionPersistence {
  readonly #redis: RedisLike;
  readonly #maxAgeSeconds: number;

  constructor(redis: RedisLike, maxAgeMs: number) {
    this.#redis = redis;
    this.#maxAgeSeconds = Math.max(1, Math.ceil(maxAgeMs / 1000));
  }

  static fromEnv(url: string, token: string, maxAgeMs: number): RedisPersistence {
    return new RedisPersistence(new Redis({ url, token }), maxAgeMs);
  }

  #key(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  /** Seconds until this request hits its max age, measured from createdAt. */
  #remainingTtl(createdAt: number): number {
    const elapsed = Math.floor((Date.now() - createdAt) / 1000);
    return Math.max(1, this.#maxAgeSeconds - elapsed);
  }

  async save(session: Session): Promise<void> {
    const key = this.#key(session.id);
    await this.#redis.set(key, toPersisted(session), {
      ex: this.#remainingTtl(session.createdAt),
    });
    await this.#redis.zadd(INDEX_KEY, {
      score: session.createdAt,
      member: session.id,
    });
  }

  async remove(id: string): Promise<void> {
    await this.#redis.del(this.#key(id));
    await this.#redis.zrem(INDEX_KEY, id);
  }

  async loadAll(): Promise<Session[]> {
    const ids = await this.#redis.zrange(INDEX_KEY, 0, -1);
    if (ids.length === 0) return [];
    const keys = ids.map((id) => this.#key(id));
    const records = await this.#redis.mget<PersistedSession>(...keys);
    const sessions: Session[] = [];
    const staleIds: string[] = [];
    records.forEach((record, i) => {
      if (record) sessions.push(fromPersisted(record));
      else staleIds.push(ids[i]); // key expired but index entry lingered
    });
    // Best-effort index cleanup so it doesn't grow unbounded with dead ids.
    await Promise.all(
      staleIds.map((id) => this.#redis.zrem(INDEX_KEY, id).catch(() => {})),
    );
    return sessions;
  }
}

/**
 * Pick persistence by env, mirroring `apps/web/lib/store` getStore(): Redis when
 * both an Upstash/KV REST URL and token are present, otherwise the no-op memory
 * backend. `log` reports which one is active (once, at startup).
 */
export function createPersistence(
  maxAgeMs: number,
  log: (line: string) => void = () => {},
): SessionPersistence {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (url && token) {
    log("durable session store: Redis (requests survive relay restarts)");
    return RedisPersistence.fromEnv(url, token, maxAgeMs);
  }
  log(
    "durable session store: in-memory (set UPSTASH_REDIS_REST_URL/_TOKEN to survive relay restarts)",
  );
  return new MemoryPersistence();
}
