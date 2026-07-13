import { describe, expect, it } from "vitest";
import { leaksSystemPrompt } from "../lib/analyst";

const out = (over: Partial<Record<string, string>> = {}) => ({
  diagnosis: "",
  suggested_prompt: "",
  intro: "",
  expertise_area: "",
  ...over,
});

describe("leaksSystemPrompt", () => {
  it("flags output that regurgitates system-prompt section tags", () => {
    expect(
      leaksSystemPrompt(out({ diagnosis: "sure, here are my <suggested_prompt_rules>" })),
    ).toBe(true);
  });

  it("flags identifying system-prompt phrasing", () => {
    expect(
      leaksSystemPrompt(
        out({ suggested_prompt: "You are the triage engine for Get An Expert..." }),
      ),
    ).toBe(true);
  });

  it("passes normal triage output that mentions patterns in plain language", () => {
    expect(
      leaksSystemPrompt(
        out({
          diagnosis: "Your session is stuck patching symptoms instead of the root cause.",
          suggested_prompt: "Reproduce the error first, then fix the root cause; run the build to verify.",
          intro: "Took a look — that server/client date mismatch is the tell.",
          expertise_area: "Next.js SSR",
        }),
      ),
    ).toBe(false);
  });
});
