import { describe, expect, it } from "vitest";
import { NullLeadStore, createLeadStore, toLeadRow } from "./leads";
import type { Session } from "./sessions";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    customerName: "Dana",
    projectDir: "/Users/dana/proj",
    issue: "Auth redirect loops on Safari",
    status: "waiting",
    online: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    permissions: { files: false, terminal: false, browser: false },
    activity: [],
    customerToken: "customer-token-secret",
    resumeTokenHash: "resume-hash",
    chat: [],
    ...overrides,
  } as Session;
}

describe("toLeadRow", () => {
  it("captures who asked and what they asked for", () => {
    const row = toLeadRow(session());
    expect(row.sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(row.customerName).toBe("Dana");
    expect(row.issue).toBe("Auth redirect loops on Safari");
    expect(row.status).toBe("waiting");
    expect(row.createdAt).toEqual(new Date(1_700_000_000_000));
  });

  it("records the outcome once an expert claims, delivers, and the session ends", () => {
    const row = toLeadRow(
      session({
        status: "ended",
        expertName: "Rohit",
        expertId: "rohit",
        claimedAt: 1_700_000_060_000,
        endedAt: 1_700_000_900_000,
        delivery: { summary: "Fixed the cookie domain", at: 1_700_000_800_000, accepted: true },
      }),
    );
    expect(row.expertName).toBe("Rohit");
    expect(row.expertId).toBe("rohit");
    expect(row.claimedAt).toEqual(new Date(1_700_000_060_000));
    expect(row.endedAt).toEqual(new Date(1_700_000_900_000));
    expect(row.deliverySummary).toBe("Fixed the cookie domain");
    expect(row.deliveryAccepted).toBe(true);
  });

  it("leaves optional fields null rather than undefined so SQL binds cleanly", () => {
    const row = toLeadRow(session({ issue: undefined }));
    expect(row.issue).toBeNull();
    expect(row.expertName).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.deliveryAccepted).toBeNull();
  });

  // The lead record is a sales/ops artifact. Secrets and the deliberately
  // unpersisted rating (decision 2026-07-17) must never reach it.
  it("never carries tokens, chat, activity, or the session rating", () => {
    const row = toLeadRow(
      session({
        chat: [{ at: 1, from: "customer", body: "hi" }],
        activity: [{ at: 1, kind: "file", summary: "read src/app.ts" }],
        delivery: { summary: "done", at: 2, rating: 5 },
      }) as Session,
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("customer-token-secret");
    expect(serialized).not.toContain("resume-hash");
    expect(row).not.toHaveProperty("chat");
    expect(row).not.toHaveProperty("activity");
    expect(row).not.toHaveProperty("rating");
    expect(serialized).not.toContain("rating");
  });
});

describe("createLeadStore", () => {
  it("is a no-op when no database is configured", async () => {
    const store = createLeadStore({});
    expect(store).toBeInstanceOf(NullLeadStore);
    // Must stay silent and resolve, so an unconfigured relay behaves as before.
    await expect(store.init()).resolves.toBeUndefined();
    await expect(store.record(session())).resolves.toBeUndefined();
  });

  it("prefers LEADS_DATABASE_URL over DATABASE_URL", () => {
    const store = createLeadStore({
      DATABASE_URL: "postgres://a/db",
      LEADS_DATABASE_URL: "postgres://b/db",
    });
    expect(store).not.toBeInstanceOf(NullLeadStore);
    expect(store.describe()).toContain("postgres://b/db".slice(0, 11));
  });
});
