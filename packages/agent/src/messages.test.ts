import { describe, expect, it } from "vitest";
import {
  END_SESSION_MESSAGE,
  EXPERT_WORK_GUIDANCE,
  queueMessage,
  statusMessage,
} from "./messages";

describe("queueMessage", () => {
  it("says a tab is opening when one was launched", () => {
    expect(queueMessage("https://r.example/chat#a.b", true)).toBe(
      "Opening your expert chat now. Your request is queued and stays queued if you close it. Link: https://r.example/chat#a.b",
    );
  });

  it("gives the link to open manually when a tab could not open", () => {
    expect(queueMessage("https://r.example/chat#a.b", false)).toBe(
      "Your request is queued. Open your expert chat here: https://r.example/chat#a.b",
    );
  });

  it("keeps a plain queue line when there is no chat url", () => {
    expect(queueMessage(undefined)).toBe(
      "You're in the expert queue. Check back anytime with expert_status.",
    );
  });
});

describe("statusMessage", () => {
  it("tells a waiting customer they can step away and the request won't be lost", () => {
    const msg = statusMessage("waiting");
    expect(msg).toContain("no expert has joined yet");
    expect(msg).toContain("won't be lost");
    expect(msg).toContain("awake");
  });

  it("names the connected expert", () => {
    const msg = statusMessage("connected", "Priya Sharma");
    expect(msg).toContain("Priya Sharma is working on your machine");
    expect(msg).toContain("keep the machine awake");
  });

  it("falls back to a generic name when the expert is unnamed", () => {
    expect(statusMessage("connected")).toContain("An expert is working");
  });

  it("reports an ended session as fully revoked", () => {
    expect(statusMessage("ended")).toBe(
      "This session has ended and all expert access is revoked.",
    );
  });

  it("handles the idle state", () => {
    expect(statusMessage("idle")).toContain("No expert session is active");
  });
});

describe("statusMessage with an expert profile", () => {
  const rohit = {
    id: "rohit",
    name: "Rohit Jain",
    photo: "/experts/rohit.jpg",
    role: "Senior software engineer",
    companies: [],
    tag: "Code, payments & APIs",
    rating: 4.8,
    fixesDelivered: 12,
  };

  it("names the role, rating, and fixes delivered when connected", () => {
    expect(statusMessage("connected", "Rohit Jain", rohit)).toBe(
      "Rohit Jain (Senior software engineer, ★ 4.8, 12 fixes delivered) is working on your machine right now, within the scopes you approved. Every action is in the log below. Feel free to step away (keep the machine awake); check back whenever you like.",
    );
  });

  it("uses the profile name even if the passed expertName differs", () => {
    const msg = statusMessage("connected", "stale name", rohit);
    expect(msg).toContain("Rohit Jain (Senior software engineer");
  });

  it("falls back to the name-only line for an incomplete profile, never rendering undefined", () => {
    // A profile missing role/rating/fixes must never leak "undefined" into the copy.
    const partial = { name: "Rohit Jain" } as never;
    const line = statusMessage("connected", "Rohit Jain", partial);
    expect(line).not.toContain("undefined");
    expect(line).toBe(statusMessage("connected", "Rohit Jain"));
  });
});

describe("END_SESSION_MESSAGE", () => {
  it("confirms all access is revoked", () => {
    expect(END_SESSION_MESSAGE).toBe("Session ended. All expert access is revoked.");
  });
});

describe("EXPERT_WORK_GUIDANCE", () => {
  it("tells the assistant to report, not review, the expert's work", () => {
    expect(EXPERT_WORK_GUIDANCE).toMatch(/do not review, grade, or second-guess/i);
    expect(EXPERT_WORK_GUIDANCE).toContain("vetted human professional");
  });

  it("leaves room for an explicit user request to evaluate", () => {
    expect(EXPERT_WORK_GUIDANCE).toMatch(/unless the user explicitly asks/i);
  });
});
