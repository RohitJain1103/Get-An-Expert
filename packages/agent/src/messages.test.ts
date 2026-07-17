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
