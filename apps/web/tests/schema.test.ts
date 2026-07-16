import { describe, expect, it } from "vitest";
import { expertRequestSchema } from "../lib/schema";

const validInput = {
  tool: "claude-code",
  goal: "Fix hydration error on dashboard",
  whatWasTried: ["asked agent to fix it", "added suppressHydrationWarning"],
  errorMessages: ["Hydration failed because ..."],
  conversationSummary: "User stuck for 12 messages on hydration error.",
  techStack: ["Next.js", "TypeScript"],
  expertiseArea: "Next.js SSR & hydration",
  messagesStuckCount: 12,
  installId: "0f31c2ee-6a5f-4a3e-9f65-1a2b3c4d5e6f",
  consent: {
    agreed: true as const,
    textVersion: "2026-07-13.v1",
    at: "2026-07-13T12:00:00Z",
  },
};

describe("expertRequestSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = expertRequestSchema.parse(validInput);
    expect(parsed.tool).toBe("claude-code");
    expect(parsed.consent.agreed).toBe(true);
  });

  it("rejects payloads without consent", () => {
    const { consent: _consent, ...withoutConsent } = validInput;
    expect(() => expertRequestSchema.parse(withoutConsent)).toThrow();
  });

  it("rejects consent that is not explicitly agreed", () => {
    expect(() =>
      expertRequestSchema.parse({
        ...validInput,
        consent: { ...validInput.consent, agreed: false },
      }),
    ).toThrow();
  });

  it("rejects oversized goals", () => {
    expect(() =>
      expertRequestSchema.parse({ ...validInput, goal: "x".repeat(2001) }),
    ).toThrow();
  });

  it("applies defaults for optional arrays", () => {
    const parsed = expertRequestSchema.parse({
      tool: "codex",
      goal: "get unstuck",
      expertiseArea: "debugging",
      consent: validInput.consent,
    });
    expect(parsed.whatWasTried).toEqual([]);
    expect(parsed.errorMessages).toEqual([]);
    expect(parsed.techStack).toEqual([]);
  });

  it("accepts an optional requesterName", () => {
    const parsed = expertRequestSchema.parse({
      ...validInput,
      requesterName: "Alex",
    });
    expect(parsed.requesterName).toBe("Alex");
  });

  it("omits requesterName when not given", () => {
    const parsed = expertRequestSchema.parse(validInput);
    expect(parsed.requesterName).toBeUndefined();
  });

  it("rejects an oversized requesterName", () => {
    expect(() =>
      expertRequestSchema.parse({
        ...validInput,
        requesterName: "x".repeat(101),
      }),
    ).toThrow();
  });
});
