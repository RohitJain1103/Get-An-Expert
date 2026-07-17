import { describe, expect, it } from "vitest";
import { SessionStore, hashResumeToken } from "./sessions";

function makeStore() {
  return new SessionStore();
}

function register(store: SessionStore) {
  return store.create({
    customerName: "Jordan Lee",
    projectDir: "~/projects/landing-page",
    issue: "TypeScript error: HeroImage is not exported from @/assets",
  }).session;
}

describe("SessionStore.create", () => {
  it("creates a waiting session with no permissions granted", () => {
    const store = makeStore();
    const s = register(store);
    expect(s.status).toBe("waiting");
    expect(s.customerName).toBe("Jordan Lee");
    expect(s.projectDir).toBe("~/projects/landing-page");
    expect(s.permissions).toEqual({
      files: false,
      terminal: false,
      browser: false,
    });
    expect(s.activity).toEqual([]);
    expect(s.id).toBeTruthy();
    expect(s.createdAt).toBeGreaterThan(0);
  });

  it("assigns unique ids", () => {
    const store = makeStore();
    const a = register(store);
    const b = register(store);
    expect(a.id).not.toBe(b.id);
  });

  it("mints a 32-hex customerToken and starts with an empty chat", () => {
    const store = makeStore();
    const s = register(store);
    expect(s.customerToken).toMatch(/^[0-9a-f]{32}$/);
    expect(s.chat).toEqual([]);
  });

  it("mints a distinct customerToken per session", () => {
    const store = makeStore();
    const a = register(store);
    const b = register(store);
    expect(a.customerToken).not.toBe(b.customerToken);
  });

  it("stores the context manifest when provided", () => {
    const store = makeStore();
    const s = store.create({
      customerName: "Dana",
      projectDir: "~/p",
      contextManifest: { conversationMessages: 12, secretsRedacted: 2 },
    }).session;
    expect(s.contextManifest).toEqual({
      conversationMessages: 12,
      secretsRedacted: 2,
    });
  });

  it("leaves the manifest undefined when none is provided", () => {
    const store = makeStore();
    expect(register(store).contextManifest).toBeUndefined();
  });
});

describe("SessionStore.claim", () => {
  it("moves a waiting session to active with the expert name", () => {
    const store = makeStore();
    const s = register(store);
    const claimed = store.claim(s.id, "Priya Sharma");
    expect(claimed.status).toBe("active");
    expect(claimed.expertName).toBe("Priya Sharma");
    expect(claimed.claimedAt).toBeGreaterThan(0);
  });

  it("does not mutate the previous session snapshot", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma");
    expect(s.status).toBe("waiting");
    expect(s.expertName).toBeUndefined();
  });

  it("rejects claiming a session already claimed by another expert", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma");
    expect(() => store.claim(s.id, "Other Expert")).toThrow(/already/i);
  });

  it("rejects claiming an unknown session", () => {
    const store = makeStore();
    expect(() => store.claim("nope", "Priya Sharma")).toThrow(/unknown/i);
  });
});

describe("SessionStore expert identity", () => {
  it("claim stores expertId and release clears it", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Rohit Jain", "rohit");
    expect(store.get(s.id)?.expertId).toBe("rohit");
    store.release(s.id);
    expect(store.get(s.id)?.expertId).toBeUndefined();
  });

  it("claim without an expertId leaves it undefined", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma");
    expect(store.get(s.id)?.expertId).toBeUndefined();
  });
});

describe("SessionStore.setIssue", () => {
  it("sets the issue and stamps issueEditedAt and issueEditedBy", () => {
    const store = makeStore();
    const s = register(store);
    const updated = store.setIssue(s.id, "new issue text", "customer");
    expect(updated.issue).toBe("new issue text");
    expect(updated.issueEditedBy).toBe("customer");
    expect(updated.issueEditedAt).toBeGreaterThan(0);
  });

  it("does not mutate the previous snapshot", () => {
    const store = makeStore();
    const s = register(store);
    store.setIssue(s.id, "edited by the expert", "expert");
    expect(s.issue).toBe(
      "TypeScript error: HeroImage is not exported from @/assets",
    );
    expect(s.issueEditedBy).toBeUndefined();
    expect(s.issueEditedAt).toBeUndefined();
  });

  it("throws for unknown sessions", () => {
    const store = makeStore();
    expect(() => store.setIssue("nope", "x", "customer")).toThrow(/unknown/i);
  });
});

describe("SessionStore delivery lifecycle", () => {
  it("setDelivery records the summary with a timestamp and no response yet", () => {
    const store = makeStore();
    const s = register(store);
    const updated = store.setDelivery(s.id, "Renamed HeroImg and re-ran the build");
    expect(updated.delivery?.summary).toBe("Renamed HeroImg and re-ran the build");
    expect(updated.delivery?.at).toBeGreaterThan(0);
    expect(updated.delivery?.respondedAt).toBeUndefined();
    expect(updated.delivery?.accepted).toBeUndefined();
  });

  it("a fresh setDelivery replaces a declined delivery outright", () => {
    const store = makeStore();
    const s = register(store);
    store.setDelivery(s.id, "first attempt");
    store.respondDelivery(s.id, false);
    const again = store.setDelivery(s.id, "second attempt");
    expect(again.delivery?.summary).toBe("second attempt");
    expect(again.delivery?.respondedAt).toBeUndefined();
    expect(again.delivery?.accepted).toBeUndefined();
  });

  it("respondDelivery records accept / decline", () => {
    const store = makeStore();
    const s = register(store);
    store.setDelivery(s.id, "the fix");
    const accepted = store.respondDelivery(s.id, true);
    expect(accepted.delivery?.accepted).toBe(true);
    expect(accepted.delivery?.respondedAt).toBeGreaterThan(0);
  });

  it("respondDelivery throws with no delivery and on a double response", () => {
    const store = makeStore();
    const s = register(store);
    expect(() => store.respondDelivery(s.id, true)).toThrow(/no delivery/i);
    store.setDelivery(s.id, "the fix");
    store.respondDelivery(s.id, true);
    expect(() => store.respondDelivery(s.id, false)).toThrow(/already responded/i);
  });

  it("setRating is valid only once, and only after an accepted delivery", () => {
    const store = makeStore();
    const s = register(store);
    store.setDelivery(s.id, "the fix");
    // Before any response: rejected.
    expect(() => store.setRating(s.id, 5)).toThrow(/accepted delivery/i);
    store.respondDelivery(s.id, false);
    // Declined: still rejected.
    expect(() => store.setRating(s.id, 5)).toThrow(/accepted delivery/i);
    store.setDelivery(s.id, "the fix again");
    store.respondDelivery(s.id, true);
    const rated = store.setRating(s.id, 5);
    expect(rated.delivery?.rating).toBe(5);
    // Double rate: rejected.
    expect(() => store.setRating(s.id, 4)).toThrow(/already been rated/i);
  });
});

describe("SessionStore.release", () => {
  it("returns an active session to waiting and clears the expert", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma");
    const released = store.release(s.id);
    expect(released.status).toBe("waiting");
    expect(released.expertName).toBeUndefined();
  });
});

describe("SessionStore.end", () => {
  it("marks the session ended with an end timestamp", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma");
    const ended = store.end(s.id);
    expect(ended?.status).toBe("ended");
    expect(ended?.endedAt).toBeGreaterThanOrEqual(ended!.createdAt);
  });

  it("removes the session from the queue", () => {
    const store = makeStore();
    const s = register(store);
    store.end(s.id);
    expect(store.queue()).toHaveLength(0);
  });

  it("is a no-op returning undefined for unknown sessions", () => {
    const store = makeStore();
    expect(store.end("nope")).toBeUndefined();
  });
});

describe("SessionStore.setPermissions", () => {
  it("records granted scopes and browser port", () => {
    const store = makeStore();
    const s = register(store);
    const updated = store.setPermissions(s.id, {
      files: true,
      terminal: true,
      browser: true,
      browserPort: 3000,
    });
    expect(updated.permissions).toEqual({
      files: true,
      terminal: true,
      browser: true,
      browserPort: 3000,
    });
  });

  it("records revocations", () => {
    const store = makeStore();
    const s = register(store);
    store.setPermissions(s.id, { files: true, terminal: true, browser: true });
    const revoked = store.setPermissions(s.id, {
      files: true,
      terminal: false,
      browser: false,
    });
    expect(revoked.permissions.terminal).toBe(false);
    expect(revoked.permissions.files).toBe(true);
  });
});

describe("SessionStore.addActivity", () => {
  it("appends activity summaries with timestamps", () => {
    const store = makeStore();
    const s = register(store);
    const updated = store.addActivity(s.id, {
      kind: "read_file",
      summary: "Expert reading: src/components/Hero.tsx",
    });
    expect(updated.activity).toHaveLength(1);
    expect(updated.activity[0].kind).toBe("read_file");
    expect(updated.activity[0].at).toBeGreaterThan(0);
  });

  it("caps the activity log at 500 entries", () => {
    const store = makeStore();
    const s = register(store);
    for (let i = 0; i < 520; i++) {
      store.addActivity(s.id, { kind: "run_command", summary: `cmd ${i}` });
    }
    const current = store.get(s.id)!;
    expect(current.activity).toHaveLength(500);
    expect(current.activity[499].summary).toBe("cmd 519");
    expect(current.activity[0].summary).toBe("cmd 20");
  });
});

describe("SessionStore.addChat", () => {
  function chatMessage(text: string) {
    return {
      at: Date.now(),
      from: "customer" as const,
      name: "Jordan Lee",
      text,
    };
  }

  it("appends chat messages", () => {
    const store = makeStore();
    const s = register(store);
    const updated = store.addChat(s.id, chatMessage("hello"));
    expect(updated.chat).toHaveLength(1);
    expect(updated.chat[0].text).toBe("hello");
  });

  it("does not mutate the previous session snapshot", () => {
    const store = makeStore();
    const s = register(store);
    store.addChat(s.id, chatMessage("hello"));
    expect(s.chat).toEqual([]);
  });

  it("caps the chat history at 200 messages, dropping the oldest", () => {
    const store = makeStore();
    const s = register(store);
    for (let i = 0; i < 220; i++) {
      store.addChat(s.id, chatMessage(`msg ${i}`));
    }
    const current = store.get(s.id)!;
    expect(current.chat).toHaveLength(200);
    expect(current.chat[0].text).toBe("msg 20");
    expect(current.chat[199].text).toBe("msg 219");
  });

  it("throws for unknown sessions", () => {
    const store = makeStore();
    expect(() => store.addChat("nope", chatMessage("hi"))).toThrow(/unknown/i);
  });
});

describe("SessionStore.queue", () => {
  it("lists waiting and active sessions oldest first", () => {
    const store = makeStore();
    const a = store.create({ customerName: "Taylor Kim", projectDir: "~/projects/dashboard" }).session;
    const b = store.create({ customerName: "Alex Chen", projectDir: "~/projects/api-server" }).session;
    store.claim(b.id, "Someone Else");
    const queue = store.queue();
    expect(queue.map((s) => s.customerName)).toEqual(["Taylor Kim", "Alex Chen"]);
    expect(queue[1].status).toBe("active");
  });
});

describe("SessionStore resume token", () => {
  it("returns a raw resume token but stores only its hash", () => {
    const store = makeStore();
    const { session, resumeToken } = store.create({
      customerName: "Jordan Lee",
      projectDir: "~/projects/landing-page",
    });
    expect(resumeToken).toMatch(/^[0-9a-f]{48}$/);
    expect(session.resumeTokenHash).toBe(hashResumeToken(resumeToken));
    expect(session.resumeTokenHash).not.toBe(resumeToken);
  });

  it("mints a distinct resume token per session", () => {
    const store = makeStore();
    const a = store.create({ customerName: "A", projectDir: "~/a" });
    const b = store.create({ customerName: "B", projectDir: "~/b" });
    expect(a.resumeToken).not.toBe(b.resumeToken);
  });
});

describe("SessionStore online/offline", () => {
  it("starts a new session online", () => {
    const store = makeStore();
    expect(register(store).online).toBe(true);
  });

  it("setOnline flips the flag and keeps the session in the queue", () => {
    const store = makeStore();
    const s = register(store);
    const offline = store.setOnline(s.id, false);
    expect(offline.online).toBe(false);
    expect(offline.status).toBe("waiting");
    expect(store.queue().map((q) => q.id)).toContain(s.id);
  });

  it("does not mutate the previous snapshot when flipping online", () => {
    const store = makeStore();
    const s = register(store);
    store.setOnline(s.id, false);
    expect(s.online).toBe(true);
  });
});

describe("SessionStore.hydrate", () => {
  it("inserts a restored session as offline and lists it in the queue", () => {
    const store = makeStore();
    const restored = store.create({ customerName: "Restored", projectDir: "~/r" }).session;
    const fresh = makeStore();
    fresh.hydrate(restored);
    const got = fresh.get(restored.id);
    expect(got?.online).toBe(false);
    expect(fresh.queue().map((q) => q.id)).toContain(restored.id);
  });

  it("never clobbers a session already live in memory", () => {
    const store = makeStore();
    const live = register(store);
    store.hydrate({ ...live, customerName: "Stale Copy", online: false });
    expect(store.get(live.id)?.customerName).toBe("Jordan Lee");
    expect(store.get(live.id)?.online).toBe(true);
  });
});

describe("SessionStore.expireBefore", () => {
  it("returns waiting and offline sessions older than the cutoff", () => {
    const store = makeStore();
    const waiting = register(store);
    const offline = register(store);
    store.setOnline(offline.id, false);
    const cutoff = Date.now() + 1_000; // everything is "old" relative to this
    expect(store.expireBefore(cutoff).sort()).toEqual(
      [waiting.id, offline.id].sort(),
    );
  });

  it("leaves an actively-worked (active + online) session alone regardless of age", () => {
    const store = makeStore();
    const s = register(store);
    store.claim(s.id, "Priya Sharma"); // active + still online
    expect(store.expireBefore(Date.now() + 1_000)).not.toContain(s.id);
  });

  it("excludes recent sessions and ended ones", () => {
    const store = makeStore();
    const recent = register(store);
    const ended = register(store);
    store.end(ended.id);
    expect(store.expireBefore(recent.createdAt)).toEqual([]);
  });
});
