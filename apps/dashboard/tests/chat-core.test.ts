import { describe, expect, it } from "vitest";
// chat-core.js is a classic browser script (no ESM syntax). Importing it for
// its side effects publishes the API on globalThis.GaeChat (window in browsers).
// @ts-expect-error: plain JS shared with the browser
import "../public/chat-core.js";

const GaeChat = (globalThis as any).GaeChat;
const {
  parseLink,
  initials,
  firstName,
  validProfile,
  reduce,
  editPayload,
  contextChips,
  nextEndStep,
  canRate,
  deliveryResponsePayload,
  ratePayload,
} = GaeChat;

// PublicExpertProfile fixture, verbatim per the Wire Contracts section.
const FIXTURE_ROHIT = {
  id: "rohit",
  name: "Rohit Jain",
  photo: "/experts/rohit.jpg",
  role: "Senior software engineer",
  companies: [
    { logo: "/experts/amazon.jpg", label: "Amazon" },
    { logo: "/experts/square.jpg", label: "Square" },
  ],
  tag: "Code, payments & APIs",
  rating: 4.8,
  fixesDelivered: 12,
  linkedin: "https://www.linkedin.com/in/rohit-jain-343437187/",
};

const FIXTURE_INIGO = {
  id: "inigo",
  name: "Iñigo Fernández",
  photo: "/experts/inigo.jpg",
  role: "AI engineer & product owner",
  companies: [{ logo: "/experts/mck.jpg", label: "McKinsey & Company" }],
  tag: "AI, RAG & agents",
  rating: 4.8,
  fixesDelivered: 6,
  linkedin: "https://www.linkedin.com/in/inigofernandezguerraabdala/",
};

/* ── parseLink ──────────────────────────────────────────────────────── */

describe("parseLink", () => {
  it("splits on the first dot into sessionId and token", () => {
    expect(parseLink("#sess123.tok456")).toEqual({
      sessionId: "sess123",
      token: "tok456",
    });
  });
  it("keeps later dots inside the token", () => {
    expect(parseLink("#abc.def.ghi")).toEqual({
      sessionId: "abc",
      token: "def.ghi",
    });
  });
  it("works without a leading hash", () => {
    expect(parseLink("abc.def")).toEqual({ sessionId: "abc", token: "def" });
  });
  it("rejects a missing token, a leading dot, and a trailing dot", () => {
    expect(parseLink("#nodots")).toBeUndefined();
    expect(parseLink("#.token")).toBeUndefined();
    expect(parseLink("#session.")).toBeUndefined();
    expect(parseLink("#")).toBeUndefined();
  });
});

/* ── initials ───────────────────────────────────────────────────────── */

describe("initials", () => {
  it("handles single and accented names", () => {
    expect(initials("Iñigo Fernández")).toBe("IF");
    expect(initials("Cher")).toBe("C");
  });
  it("uses the first and last word for longer names", () => {
    expect(initials("Pulkit Kumar Walia")).toBe("PW");
  });
  it("returns an empty string for empty input", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });
});

/* ── firstName ──────────────────────────────────────────────────────── */

describe("firstName", () => {
  it("returns the first word", () => {
    expect(firstName("Rohit Jain")).toBe("Rohit");
    expect(firstName("Iñigo Fernández")).toBe("Iñigo");
  });
  it("returns an empty string for empty input", () => {
    expect(firstName("")).toBe("");
  });
});

/* ── validProfile ───────────────────────────────────────────────────── */

describe("validProfile", () => {
  it("accepts a well-formed profile off the wire", () => {
    expect(validProfile(FIXTURE_ROHIT)).toBe(true);
  });
  it("rejects a profile missing photo", () => {
    const { photo, ...noPhoto } = FIXTURE_ROHIT;
    expect(validProfile(noPhoto)).toBe(false);
  });
  it("rejects a profile whose rating is not a number", () => {
    expect(validProfile({ ...FIXTURE_ROHIT, rating: "4.8" })).toBe(false);
  });
  it("rejects a profile whose companies is not an array", () => {
    expect(validProfile({ ...FIXTURE_ROHIT, companies: undefined })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(validProfile(undefined)).toBe(false);
    expect(validProfile(null)).toBe(false);
    expect(validProfile("rohit")).toBe(false);
  });
});

/* ── reduce ─────────────────────────────────────────────────────────── */

describe("reduce", () => {
  const helloWaiting = {
    type: "hello-ok",
    status: "waiting",
    history: [],
    activity: [],
    bench: [FIXTURE_ROHIT, FIXTURE_INIGO],
    permissions: { files: true, terminal: true, browser: true },
    issue: "Login drops on refresh.",
  };

  it("hello-ok waiting seeds bench, permissions and issue without an expert", () => {
    const s = reduce(undefined, helloWaiting);
    expect(s.phase).toBe("waiting");
    expect(s.expert).toBeUndefined();
    expect(s.bench.map((e: any) => e.id)).toEqual(["rohit", "inigo"]);
    expect(s.permissions).toEqual({ files: true, terminal: true, browser: true });
    expect(s.issue).toBe("Login drops on refresh.");
    expect(s.feed).toEqual([]);
  });

  it("hello-ok stores the context manifest for the chips", () => {
    const s = reduce(undefined, {
      ...helloWaiting,
      contextManifest: { conversationMessages: 12, secretsRedacted: 1 },
    });
    expect(s.manifest).toEqual({ conversationMessages: 12, secretsRedacted: 1 });
  });

  it("expert-joined moves waiting to claimed and stores the profile", () => {
    const s0 = reduce(undefined, helloWaiting);
    const s1 = reduce(s0, {
      type: "expert-joined",
      expertName: "Rohit Jain",
      expert: FIXTURE_ROHIT,
    });
    expect(s1.phase).toBe("claimed");
    expect(s1.expert.id).toBe("rohit");
    // bench survives the claim
    expect(s1.bench.length).toBe(2);
  });

  it("expert-left returns to waiting and clears the card", () => {
    const s0 = reduce(undefined, helloWaiting);
    const s1 = reduce(s0, {
      type: "expert-joined",
      expertName: "Rohit Jain",
      expert: FIXTURE_ROHIT,
    });
    const s2 = reduce(s1, { type: "expert-left" });
    expect(s2.phase).toBe("waiting");
    expect(s2.expert).toBeUndefined();
    expect(s2.bench.length).toBe(2);
  });

  it("a claimed hello-ok restores the card and feed after reload", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      expertName: "Rohit Jain",
      expert: FIXTURE_ROHIT,
      bench: [FIXTURE_ROHIT, FIXTURE_INIGO],
      permissions: { files: true, terminal: true, browser: false },
      issue: "Login drops on refresh.",
      history: [
        { from: "customer", name: "You", text: "hi", at: 200 },
        { from: "expert", name: "Rohit Jain", text: "on it", at: 100 },
      ],
      activity: [{ summary: "Read auth.ts", at: 150 }],
    });
    expect(s.phase).toBe("claimed");
    expect(s.expert.id).toBe("rohit");
    // history + activity interleaved by timestamp
    expect(s.feed.map((f: any) => f.kind)).toEqual(["chat", "activity", "chat"]);
    expect(s.feed[0].message.text).toBe("on it");
    expect(s.feed[1].entry.summary).toBe("Read auth.ts");
    expect(s.feed[2].message.text).toBe("hi");
  });

  it("hello-ok ignores an expert that fails the profile guard", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      expertName: "Rohit Jain",
      expert: { id: "rohit", name: "Rohit Jain" }, // missing required fields
      bench: [],
      history: [],
      activity: [],
    });
    expect(s.phase).toBe("claimed");
    expect(s.expert).toBeUndefined();
    expect(s.expertName).toBe("Rohit Jain");
  });

  it("chat and activity append to the feed while claimed", () => {
    const s0 = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      expert: FIXTURE_ROHIT,
      bench: [],
      history: [],
      activity: [],
    });
    const s1 = reduce(s0, {
      type: "chat",
      message: { from: "expert", name: "Rohit", text: "hello", at: 10 },
    });
    const s2 = reduce(s1, {
      type: "activity",
      entry: { summary: "Ran tests", at: 20 },
    });
    expect(s2.feed.map((f: any) => f.kind)).toEqual(["chat", "activity"]);
    expect(s2.feed[1].entry.summary).toBe("Ran tests");
  });

  it("session-ended moves to ended but keeps the expert for the mini row", () => {
    const s0 = reduce(undefined, {
      type: "expert-joined",
      expertName: "Rohit Jain",
      expert: FIXTURE_ROHIT,
    });
    const s1 = reduce(s0, { type: "session-ended" });
    expect(s1.phase).toBe("ended");
    expect(s1.expert.id).toBe("rohit");
  });

  it("drops chat and activity once the session has ended", () => {
    const s0 = reduce(undefined, { type: "session-ended" });
    const s1 = reduce(s0, {
      type: "chat",
      message: { from: "expert", text: "late", at: 1 },
    });
    expect(s1.feed).toEqual([]);
  });

  it("hello-failed moves to the failed phase", () => {
    const s = reduce(undefined, { type: "hello-failed" });
    expect(s.phase).toBe("failed");
  });

  it("is pure: it never mutates the input state", () => {
    const s0 = reduce(undefined, helloWaiting);
    const before = JSON.stringify(s0);
    reduce(s0, {
      type: "chat",
      message: { from: "customer", text: "hi", at: 1 },
    });
    expect(JSON.stringify(s0)).toBe(before);
  });

  it("ignores messages with no usable type", () => {
    const s0 = reduce(undefined, helloWaiting);
    expect(reduce(s0, {})).toBe(s0);
    expect(reduce(s0, { type: 42 })).toBe(s0);
  });

  it("issue-updated replaces the issue text (customer edit echo)", () => {
    const s0 = reduce(undefined, helloWaiting);
    const s1 = reduce(s0, {
      type: "issue-updated",
      issue: "Revised: login also drops on tab focus.",
      by: "customer",
      at: 123,
    });
    expect(s1.issue).toBe("Revised: login also drops on tab focus.");
  });

  it("issue-updated from the expert also updates the issue", () => {
    const s0 = reduce(undefined, helloWaiting);
    const s1 = reduce(s0, {
      type: "issue-updated",
      issue: "Reworded by the expert.",
      by: "expert",
      at: 200,
    });
    expect(s1.issue).toBe("Reworded by the expert.");
  });

  it("issue-updated is ignored once the session has ended", () => {
    const s0 = reduce(undefined, { type: "session-ended" });
    const s1 = reduce(s0, { type: "issue-updated", issue: "too late", by: "expert", at: 1 });
    expect(s1.issue).toBeUndefined();
  });

  it("edit-rejected leaves the issue unchanged (customers always win)", () => {
    const s0 = reduce(undefined, helloWaiting);
    const s1 = reduce(s0, {
      type: "edit-rejected",
      issue: "someone else's version",
      reason: "stale",
      at: 1,
      by: "customer",
    });
    expect(s1.issue).toBe(helloWaiting.issue);
  });
});

/* ── editPayload ────────────────────────────────────────────────────── */

describe("editPayload", () => {
  it("trims and wraps valid text as an edit-issue message", () => {
    expect(editPayload("  new problem statement  ")).toEqual({
      type: "edit-issue",
      text: "new problem statement",
    });
  });

  it("returns undefined for empty or whitespace-only text", () => {
    expect(editPayload("")).toBeUndefined();
    expect(editPayload("   ")).toBeUndefined();
  });

  it("clamps to 2000 characters", () => {
    const long = "a".repeat(2500);
    const payload = editPayload(long);
    expect(payload.text.length).toBe(2000);
  });

  it("returns undefined for non-string input", () => {
    expect(editPayload(undefined)).toBeUndefined();
    expect(editPayload(42)).toBeUndefined();
  });
});

/* ── contextChips ───────────────────────────────────────────────────── */

describe("contextChips", () => {
  it("shows only the always-true chips when there is no manifest", () => {
    expect(contextChips(undefined)).toEqual([
      "Your agent's summary",
      "A short overview of your project",
    ]);
  });

  it("adds the count chips when both fields are numbers", () => {
    expect(
      contextChips({ conversationMessages: 47, secretsRedacted: 3 }),
    ).toEqual([
      "Your agent's summary",
      "This conversation, 47 messages",
      "A short overview of your project",
      "3 secrets removed",
    ]);
  });

  it("hides the secrets chip when nothing was redacted", () => {
    // "0 secrets removed" reads as a warning, not reassurance, so it is omitted.
    expect(
      contextChips({ conversationMessages: 0, secretsRedacted: 0 }),
    ).toEqual([
      "Your agent's summary",
      "This conversation, 0 messages",
      "A short overview of your project",
    ]);
  });

  it("omits a chip whose field is absent or not a number", () => {
    expect(contextChips({ secretsRedacted: 2 })).toEqual([
      "Your agent's summary",
      "A short overview of your project",
      "2 secrets removed",
    ]);
    expect(
      contextChips({ conversationMessages: 5, secretsRedacted: "x" }),
    ).toEqual([
      "Your agent's summary",
      "This conversation, 5 messages",
      "A short overview of your project",
    ]);
  });
});

/* ── nextEndStep (customer End session two-step confirm) ─────────────── */

describe("nextEndStep", () => {
  it("arms from idle (first tap)", () => {
    expect(nextEndStep("idle", "arm")).toBe("armed");
    expect(nextEndStep(undefined, "arm")).toBe("armed");
  });

  it("cancels back to idle from armed (Keep going / Esc)", () => {
    expect(nextEndStep("armed", "cancel")).toBe("idle");
  });

  it("confirms to ending only from armed (Yes, end it)", () => {
    expect(nextEndStep("armed", "confirm")).toBe("ending");
    // A confirm can never fire without first arming.
    expect(nextEndStep("idle", "confirm")).toBe("idle");
  });

  it("leaves the step unchanged on an unknown action", () => {
    expect(nextEndStep("armed", "nope")).toBe("armed");
  });
});

/* ── delivery lifecycle ─────────────────────────────────────────────── */

function claimed() {
  return reduce(undefined, {
    type: "hello-ok",
    status: "active",
    expert: FIXTURE_ROHIT,
    bench: [FIXTURE_ROHIT],
    permissions: { files: true, terminal: false, browser: false },
    issue: "session drops on refresh",
    history: [],
    activity: [],
  });
}

describe("reduce: delivery", () => {
  it("delivered stores the pending delivery and stays working (claimed)", () => {
    const s = reduce(claimed(), { type: "delivered", summary: "renamed and rebuilt", at: 111 });
    expect(s.phase).toBe("claimed");
    expect(s.delivery).toEqual({ summary: "renamed and rebuilt", at: 111 });
  });

  it("delivered ignores a malformed record", () => {
    const s0 = claimed();
    const s = reduce(s0, { type: "delivered", at: 111 });
    expect(s.delivery).toBeUndefined();
  });

  it("delivery-accepted moves to the done screen and records acceptance", () => {
    const s0 = reduce(claimed(), { type: "delivered", summary: "the fix", at: 111 });
    const s = reduce(s0, { type: "delivery-accepted", at: 222 });
    expect(s.phase).toBe("done");
    expect(s.delivery.accepted).toBe(true);
    expect(s.delivery.respondedAt).toBe(222);
    // Accepting never ends the session.
    expect(s.phase).not.toBe("ended");
  });

  it("delivery-declined clears the pending card but stays working", () => {
    const s0 = reduce(claimed(), { type: "delivered", summary: "the fix", at: 111 });
    const s = reduce(s0, { type: "delivery-declined", at: 222 });
    expect(s.phase).toBe("claimed");
    expect(s.delivery.respondedAt).toBe(222);
    expect(s.delivery.accepted).toBe(false);
  });

  it("a fresh delivered after a decline replaces the record and reopens the card", () => {
    let s = reduce(claimed(), { type: "delivered", summary: "attempt 1", at: 1 });
    s = reduce(s, { type: "delivery-declined", at: 2 });
    s = reduce(s, { type: "delivered", summary: "attempt 2", at: 3 });
    expect(s.phase).toBe("claimed");
    expect(s.delivery).toEqual({ summary: "attempt 2", at: 3 });
  });

  it("rated is a no-op for the customer state", () => {
    const s0 = reduce(claimed(), { type: "delivered", summary: "the fix", at: 111 });
    const s1 = reduce(s0, { type: "delivery-accepted", at: 222 });
    const s2 = reduce(s1, { type: "rated", rating: 5 });
    expect(s2).toEqual(s1);
  });

  it("hello-ok restores a pending delivery as the working card", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      expert: FIXTURE_ROHIT,
      bench: [FIXTURE_ROHIT],
      history: [],
      activity: [],
      delivery: { summary: "the fix", at: 111 },
    });
    expect(s.phase).toBe("claimed");
    expect(s.delivery.summary).toBe("the fix");
    expect(s.delivery.accepted).toBeUndefined();
  });

  it("hello-ok restores an accepted delivery as the done screen", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      expert: FIXTURE_ROHIT,
      bench: [FIXTURE_ROHIT],
      history: [],
      activity: [],
      delivery: { summary: "the fix", at: 111, respondedAt: 222, accepted: true },
    });
    expect(s.phase).toBe("done");
  });

  it("hello-ok on an ended session stays ended even with an accepted delivery", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "ended",
      bench: [],
      history: [],
      activity: [],
      delivery: { summary: "the fix", at: 1, respondedAt: 2, accepted: true },
    });
    expect(s.phase).toBe("ended");
  });
});

describe("canRate", () => {
  it("is true only after an accepted delivery with no rating yet", () => {
    const s0 = reduce(claimed(), { type: "delivered", summary: "the fix", at: 1 });
    expect(canRate(s0)).toBe(false); // pending, not accepted
    const s1 = reduce(s0, { type: "delivery-accepted", at: 2 });
    expect(canRate(s1)).toBe(true);
  });

  it("is false once a rating exists", () => {
    const s = reduce(undefined, {
      type: "hello-ok",
      status: "active",
      bench: [],
      history: [],
      activity: [],
      delivery: { summary: "the fix", at: 1, respondedAt: 2, accepted: true, rating: 5 },
    });
    expect(canRate(s)).toBe(false);
  });

  it("is false while working or declined", () => {
    expect(canRate(claimed())).toBe(false);
    const declined = reduce(
      reduce(claimed(), { type: "delivered", summary: "x", at: 1 }),
      { type: "delivery-declined", at: 2 },
    );
    expect(canRate(declined)).toBe(false);
  });
});

describe("deliveryResponsePayload", () => {
  it("wraps accept and decline", () => {
    expect(deliveryResponsePayload(true)).toEqual({ type: "delivery-response", accepted: true });
    expect(deliveryResponsePayload(false)).toEqual({ type: "delivery-response", accepted: false });
  });
});

describe("ratePayload", () => {
  it("accepts integers 1..5", () => {
    expect(ratePayload(1)).toEqual({ type: "rate", rating: 1 });
    expect(ratePayload(5)).toEqual({ type: "rate", rating: 5 });
  });
  it("rounds a fractional star to the nearest integer", () => {
    expect(ratePayload(4.4)).toEqual({ type: "rate", rating: 4 });
  });
  it("rejects out-of-range and non-numbers", () => {
    expect(ratePayload(0)).toBeUndefined();
    expect(ratePayload(6)).toBeUndefined();
    expect(ratePayload("5" as unknown as number)).toBeUndefined();
    expect(ratePayload(NaN)).toBeUndefined();
  });
});
