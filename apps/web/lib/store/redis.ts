import { Redis } from "@upstash/redis";
import type {
  NewThreadMessage,
  ThreadMessage,
} from "@get-an-expert/core";
import type { Store, StoredRequest } from "./types";

const RECORD_PREFIX = "gae:req:";
const INDEX_KEY = "gae:req:index";

const messagesKey = (id: string): string => `${RECORD_PREFIX}${id}:msgs`;

/**
 * Upstash Redis store. Records live under gae:req:<id> with a TTL enforcing
 * the retention window; a sorted set (score = created-at epoch ms) provides
 * newest-first listing. Index entries whose record has expired are pruned
 * lazily on list().
 */
export class RedisStore implements Store {
  constructor(private redis: Redis) {}

  static fromEnv(url: string, token: string): RedisStore {
    return new RedisStore(new Redis({ url, token }));
  }

  async create(record: StoredRequest, ttlSeconds: number): Promise<void> {
    await this.redis.set(RECORD_PREFIX + record.id, record, {
      ex: ttlSeconds,
    });
    await this.redis.zadd(INDEX_KEY, {
      score: Date.parse(record.createdAt),
      member: record.id,
    });
  }

  async get(id: string): Promise<StoredRequest | null> {
    return (await this.redis.get<StoredRequest>(RECORD_PREFIX + id)) ?? null;
  }

  async put(record: StoredRequest, ttlSeconds: number): Promise<void> {
    // keepTtl preserves the original retention deadline; fall back to the
    // full TTL only if the key somehow lost it.
    const ttl = await this.redis.ttl(RECORD_PREFIX + record.id);
    await this.redis.set(RECORD_PREFIX + record.id, record, {
      ex: ttl > 0 ? ttl : ttlSeconds,
    });
  }

  async list(limit: number): Promise<StoredRequest[]> {
    const ids = await this.redis.zrange<string[]>(INDEX_KEY, 0, limit * 2, {
      rev: true,
    });
    if (ids.length === 0) return [];

    const records = await Promise.all(ids.map((id) => this.get(id)));
    const live: StoredRequest[] = [];
    const dead: string[] = [];
    ids.forEach((id, i) => {
      const record = records[i];
      if (record) live.push(record);
      else dead.push(id);
    });
    if (dead.length > 0) {
      await this.redis.zrem(INDEX_KEY, ...dead);
    }
    return live.slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    const removed = await this.redis.del(RECORD_PREFIX + id, messagesKey(id));
    await this.redis.zrem(INDEX_KEY, id);
    return removed > 0;
  }

  async appendMessage(
    id: string,
    message: NewThreadMessage,
    ttlSeconds: number,
  ): Promise<number> {
    // RPUSH returns the new list length, which doubles as the appended
    // message's 1-based seq — concurrent appends get distinct seqs for free.
    const seq = await this.redis.rpush(messagesKey(id), message);
    // Align the thread's lifetime with the record's remaining retention
    // window so both expire together. NX + every-append: even if a crash
    // skipped an earlier EXPIRE, the next append repairs it, so the key can
    // never outlive the 30-day promise by more than one quiet thread.
    const ttl = await this.redis.ttl(RECORD_PREFIX + id);
    await this.redis.expire(messagesKey(id), ttl > 0 ? ttl : ttlSeconds, "nx");
    return seq;
  }

  async listMessages(id: string, afterSeq: number): Promise<ThreadMessage[]> {
    const items = await this.redis.lrange<NewThreadMessage>(
      messagesKey(id),
      afterSeq,
      -1,
    );
    // seq is positional: the element at list index i has seq i + 1.
    return items.map((m, i) => ({ ...m, seq: afterSeq + i + 1 }));
  }

  async countMessages(id: string): Promise<number> {
    return this.redis.llen(messagesKey(id));
  }

  async incrWindow(key: string, windowSeconds: number): Promise<number> {
    const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
    const fullKey = `gae:rl:${key}:${windowStart}`;
    const count = await this.redis.incr(fullKey);
    if (count === 1) {
      await this.redis.expire(fullKey, windowSeconds);
    }
    return count;
  }
}
