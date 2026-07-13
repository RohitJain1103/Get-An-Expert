import { describe, expect, it } from "vitest";
import { buildOfferMessage } from "./consent";

describe("buildOfferMessage", () => {
  const message = buildOfferMessage("React state management");

  it("names the expertise area in the attention line", () => {
    expect(message).toContain("React state management");
    expect(message).toContain("✨");
  });

  it("contains the compliance-required elements", () => {
    // explicit opt-in ask
    expect(message).toContain("Send it? (yes / no)");
    // what-we-send / never-send pairing
    expect(message).toContain("What gets sent");
    expect(message).toContain("Never sent:");
    // a human expert responds — never promise an AI answer
    expect(message).toContain("human expert");
    expect(message).not.toMatch(/\bAI[- ]/i);
    // retention + deletion
    expect(message).toContain("30 days");
    expect(message.toLowerCase()).toContain("deletion");
    // privacy policy link
    expect(message).toContain("/privacy");
  });
});
