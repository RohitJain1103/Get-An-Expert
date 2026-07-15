import { describe, expect, it } from "vitest";
import { SessionStore } from "./sessions";

function makeStore() {
  return new SessionStore();
}

function register(store: SessionStore) {
  return store.create({
    customerName: "Jordan Lee",
    projectDir: "~/projects/landing-page",
    issue: "TypeScript error: HeroImage is not exported from @/assets",
  });
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

describe("SessionStore.queue", () => {
  it("lists waiting and active sessions oldest first", () => {
    const store = makeStore();
    const a = store.create({ customerName: "Taylor Kim", projectDir: "~/projects/dashboard" });
    const b = store.create({ customerName: "Alex Chen", projectDir: "~/projects/api-server" });
    store.claim(b.id, "Someone Else");
    const queue = store.queue();
    expect(queue.map((s) => s.customerName)).toEqual(["Taylor Kim", "Alex Chen"]);
    expect(queue[1].status).toBe("active");
  });
});
