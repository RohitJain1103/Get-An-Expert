import { describe, expect, it } from "vitest";
import {
  checkChatPollRateLimit,
  checkChatPostRateLimit,
  checkRateLimit,
} from "../lib/ratelimit";
import { MemoryStore } from "../lib/store/memory";

describe("checkRateLimit", () => {
  it("allows requests under the per-install limit", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 6; i++) {
      const decision = await checkRateLimit(store, "1.2.3.4", "install-a");
      expect(decision.allowed).toBe(true);
    }
  });

  it("blocks the 7th request from one install within an hour", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 6; i++) {
      await checkRateLimit(store, "1.2.3.4", "install-a");
    }
    const decision = await checkRateLimit(store, "1.2.3.4", "install-a");
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("blocks by IP even without an install id", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 12; i++) {
      const decision = await checkRateLimit(store, "5.6.7.8");
      expect(decision.allowed).toBe(true);
    }
    const decision = await checkRateLimit(store, "5.6.7.8");
    expect(decision.allowed).toBe(false);
  });
});

describe("chat rate limits", () => {
  it("allows 30 chat posts per minute per IP, then blocks", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 30; i++) {
      expect((await checkChatPostRateLimit(store, "1.2.3.4")).allowed).toBe(
        true,
      );
    }
    expect((await checkChatPostRateLimit(store, "1.2.3.4")).allowed).toBe(
      false,
    );
    // Different IP unaffected.
    expect((await checkChatPostRateLimit(store, "5.6.7.8")).allowed).toBe(true);
  });

  it("allows 240 chat polls per minute per IP, then blocks", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 240; i++) {
      expect((await checkChatPollRateLimit(store, "1.2.3.4")).allowed).toBe(
        true,
      );
    }
    expect((await checkChatPollRateLimit(store, "1.2.3.4")).allowed).toBe(
      false,
    );
  });
});
