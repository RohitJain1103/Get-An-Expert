import { describe, expect, it } from "vitest";
import {
  MemoryPersistence,
  RedisPersistence,
  fromPersisted,
  toPersisted,
  type RedisLike,
} from "./persistence";
import { SessionStore } from "./sessions";

function makeSession(overrides: Partial<Parameters<SessionStore["create"]>[0]> = {}) {
  return new SessionStore().create({
    customerName: "Dana",
    projectDir: "~/project",
    issue: "build broken",
    ...overrides,
  }).session;
}

/** Minimal in-process stand-in for the Upstash REST client. */
class FakeRedis implements RedisLike {
  store = new Map<string, unknown>();
  index = new Map<string, number>(); // member -> score

  async set(key: string, value: unknown): Promise<unknown> {
    // JSON round-trip mirrors Upstash's serialize/deserialize.
    this.store.set(key, JSON.parse(JSON.stringify(value)));
    return "OK";
  }
  async del(...keys: string[]): Promise<unknown> {
    for (const k of keys) this.store.delete(k);
    return keys.length;
  }
  async zadd(_key: string, member: { score: number; member: string }): Promise<unknown> {
    this.index.set(member.member, member.score);
    return 1;
  }
  async zrem(_key: string, member: string): Promise<unknown> {
    this.index.delete(member);
    return 1;
  }
  async zrange(_key: string, _start: number, _stop: number): Promise<string[]> {
    return [...this.index.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }
  async mget<T>(...keys: string[]): Promise<(T | null)[]> {
    return keys.map((k) => (this.store.get(k) as T) ?? null);
  }
}

describe("persisted session mapping", () => {
  it("round-trips durable fields and drops chat/activity", () => {
    const store = new SessionStore();
    const s = store.create({ customerName: "Dana", projectDir: "~/p" }).session;
    store.addActivity(s.id, { kind: "read_file", summary: "reading x" });
    const withActivity = store.get(s.id)!;
    const restored = fromPersisted(toPersisted(withActivity));
    expect(restored.id).toBe(s.id);
    expect(restored.resumeTokenHash).toBe(s.resumeTokenHash);
    expect(restored.customerToken).toBe(s.customerToken);
    expect(restored.online).toBe(false);
    expect(restored.activity).toEqual([]);
    expect(restored.chat).toEqual([]);
  });

  it("demotes a claimed session back to waiting (the expert must re-claim)", () => {
    const store = new SessionStore();
    const s = store.create({ customerName: "Dana", projectDir: "~/p" }).session;
    store.claim(s.id, "Priya");
    const restored = fromPersisted(toPersisted(store.get(s.id)!));
    expect(restored.status).toBe("waiting");
    expect(restored.expertName).toBeUndefined();
  });

  it("serializes the expert roster id but clears it on hydrate (must re-claim)", () => {
    const store = new SessionStore();
    const s = store.create({ customerName: "Dana", projectDir: "~/p" }).session;
    store.claim(s.id, "Rohit Jain", "rohit");
    const persisted = toPersisted(store.get(s.id)!);
    expect(persisted.expertId).toBe("rohit");
    // A hydrated session comes back waiting and must be re-claimed, so the
    // expert identity is cleared alongside expertName (Wire Contract: an
    // expert profile is only present when the session is claimed).
    expect(fromPersisted(persisted).expertId).toBeUndefined();
  });
});

describe("MemoryPersistence", () => {
  it("is a no-op that loads nothing", async () => {
    const p = new MemoryPersistence();
    await p.save(makeSession());
    expect(await p.loadAll()).toEqual([]);
  });
});

describe("RedisPersistence", () => {
  it("saves and loads a session", async () => {
    const redis = new FakeRedis();
    const p = new RedisPersistence(redis, 72 * 60 * 60 * 1000);
    const s = makeSession();
    await p.save(s);
    const loaded = await p.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(s.id);
    expect(loaded[0].online).toBe(false);
    expect(loaded[0].resumeTokenHash).toBe(s.resumeTokenHash);
  });

  it("removes a session and cleans its index entry", async () => {
    const redis = new FakeRedis();
    const p = new RedisPersistence(redis, 1000);
    const s = makeSession();
    await p.save(s);
    await p.remove(s.id);
    expect(await p.loadAll()).toEqual([]);
    expect(redis.index.size).toBe(0);
  });

  it("orders loaded sessions oldest-first and prunes stale index entries", async () => {
    const redis = new FakeRedis();
    const p = new RedisPersistence(redis, 1000);
    const older = makeSession();
    const newer = makeSession();
    await p.save({ ...older, createdAt: 1_000 });
    await p.save({ ...newer, createdAt: 2_000 });
    // Simulate the newer key expiring while its index entry lingers.
    redis.store.delete(`gae:relay:session:${newer.id}`);
    const loaded = await p.loadAll();
    expect(loaded.map((s) => s.id)).toEqual([older.id]);
    expect(redis.index.has(newer.id)).toBe(false); // pruned
  });
});
