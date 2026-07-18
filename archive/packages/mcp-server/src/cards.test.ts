import { describe, expect, it } from "vitest";
import type { SessionStatusRecord } from "@get-an-expert/core/relay";
import { consentCardData, statusCardData, tildify } from "./cards";

describe("tildify", () => {
  it("shortens paths under home to ~/", () => {
    expect(tildify("/Users/sam/my-project", "/Users/sam")).toBe("~/my-project");
  });

  it("shortens home itself to ~", () => {
    expect(tildify("/Users/sam", "/Users/sam")).toBe("~");
  });

  it("leaves paths outside home alone", () => {
    expect(tildify("/opt/work", "/Users/sam")).toBe("/opt/work");
  });

  it("does not treat a sibling prefix as home", () => {
    expect(tildify("/Users/samantha/x", "/Users/sam")).toBe(
      "/Users/samantha/x",
    );
  });
});

describe("consentCardData", () => {
  it("carries the expertise area, project dir and privacy url", () => {
    const data = consentCardData(
      "React state management",
      "https://example.com/privacy",
      "/Users/sam/my-project",
    );
    expect(data.card).toBe("consent");
    expect(data.expertiseArea).toBe("React state management");
    expect(data.privacyUrl).toBe("https://example.com/privacy");
    expect(data.projectDir.endsWith("my-project")).toBe(true);
  });
});

describe("statusCardData", () => {
  const base: SessionStatusRecord = {
    state: "connected",
    expertName: "Rohit Jain",
    chatUrl: "https://example.com/chat",
    recentActivity: [
      { at: 1, kind: "read_file", summary: "Expert reading: a.ts" },
      { at: 2, kind: "run_command", summary: "Expert ran: npm test" },
    ],
    updatedAt: 5,
    startedAt: 1,
    expertProfile: {
      name: "Rohit Jain",
      role: "Senior software engineer",
      rating: 4.8,
      fixesDelivered: 12,
    },
  };

  it("maps a null status to the idle card", () => {
    expect(statusCardData(null)).toEqual({
      card: "status",
      state: "idle",
      activity: [],
    });
  });

  it("maps ended sessions to idle, matching the text fallback", () => {
    expect(statusCardData({ ...base, state: "ended" }).state).toBe("idle");
  });

  it("passes waiting through so the card shows the radar", () => {
    const data = statusCardData({
      ...base,
      state: "waiting",
      expertName: undefined,
      expertProfile: undefined,
    });
    expect(data.state).toBe("waiting");
    expect(data.profile).toBeUndefined();
  });

  it("carries profile, chat url and activity for a connected session", () => {
    const data = statusCardData(base);
    expect(data.state).toBe("connected");
    expect(data.profile?.rating).toBe(4.8);
    expect(data.chatUrl).toBe("https://example.com/chat");
    expect(data.activity).toHaveLength(2);
    expect(data.activity[1].summary).toContain("npm test");
    expect(data.lastDelivery).toBeUndefined();
  });

  it("carries the last delivery so the card can enter delivered mode", () => {
    const data = statusCardData({
      ...base,
      lastDelivery: { summary: "Fixed the invoice leak", accepted: true },
    });
    expect(data.lastDelivery?.summary).toBe("Fixed the invoice leak");
    expect(data.lastDelivery?.accepted).toBe(true);
    expect(data.startedAt).toBe(1);
  });

  it("trims activity to the last 20 entries", () => {
    const record: SessionStatusRecord = {
      ...base,
      recentActivity: Array.from({ length: 30 }, (_, i) => ({
        at: i,
        kind: "run_command",
        summary: `cmd ${i}`,
      })),
    };
    const data = statusCardData(record);
    expect(data.activity).toHaveLength(20);
    expect(data.activity[0].summary).toBe("cmd 10");
  });
});
