import type { Store, StoredRequest } from "./types";

interface Entry {
  record: StoredRequest;
  expiresAt: number;
}

/**
 * In-memory store for local dev and tests. Not durable — production uses the
 * Redis store. Records are deep-copied on the way in and out so callers can
 * never mutate stored state.
 */
export class MemoryStore implements Store {
  private entries = new Map<string, Entry>();
  private counters = new Map<string, { count: number; expiresAt: number }>();

  private now(): number {
    return Date.now();
  }

  private live(id: string): Entry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  async create(record: StoredRequest, ttlSeconds: number): Promise<void> {
    this.entries.set(record.id, {
      record: structuredClone(record),
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  async get(id: string): Promise<StoredRequest | null> {
    const entry = this.live(id);
    return entry ? structuredClone(entry.record) : null;
  }

  async put(record: StoredRequest, ttlSeconds: number): Promise<void> {
    const existing = this.live(record.id);
    this.entries.set(record.id, {
      record: structuredClone(record),
      // Keep the original expiry if the record already exists; put() must
      // not extend the retention window.
      expiresAt: existing?.expiresAt ?? this.now() + ttlSeconds * 1000,
    });
  }

  async list(limit: number): Promise<StoredRequest[]> {
    const live = [...this.entries.keys()]
      .map((id) => this.live(id))
      .filter((e): e is Entry => e !== null)
      .map((e) => structuredClone(e.record));
    return live
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async incrWindow(key: string, windowSeconds: number): Promise<number> {
    const windowStart = Math.floor(this.now() / 1000 / windowSeconds);
    const fullKey = `${key}:${windowStart}`;
    const existing = this.counters.get(fullKey);
    if (!existing || existing.expiresAt <= this.now()) {
      this.counters.set(fullKey, {
        count: 1,
        expiresAt: this.now() + windowSeconds * 1000,
      });
      return 1;
    }
    const next = { ...existing, count: existing.count + 1 };
    this.counters.set(fullKey, next);
    return next.count;
  }
}
