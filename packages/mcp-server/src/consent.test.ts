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
    expect(message).toContain("Proceed? (yes / no)");
    // what-we-send / never-send pairing
    expect(message).toContain("What gets sent");
    expect(message).toContain("Never sent:");
    // experts-only: a human reviews, and the chat has no AI in it
    expect(message.toLowerCase()).toContain("reviewed by a real person");
    // retention + deletion
    expect(message).toContain("30 days");
    expect(message.toLowerCase()).toContain("deletion");
    // privacy policy link
    expect(message).toContain("/privacy");
  });

  it("discloses the session relay in full (the one-time consent)", () => {
    // scope: what relays, from when, until when
    expect(message).toContain("relayed live to the expert");
    expect(message.toLowerCase()).toContain("until the chat ends");
    expect(message.toLowerCase()).toContain("your prompts");
    expect(message.toLowerCase()).toContain("your agent's replies");
    expect(message.toLowerCase()).toContain(
      "commands your agent runs and their output",
    );
    expect(message.toLowerCase()).toContain("file edits");
    // local redaction before transmission
    expect(message.toLowerCase()).toContain("redact");
    // hard stop + pause + visibility
    expect(message.toLowerCase()).toContain("end it anytime");
    expect(message.toLowerCase()).toContain("/pause");
    expect(message).toContain("RELAY ON");
    // the chat itself is human-to-human
    expect(message.toLowerCase()).toContain("no ai reads");
    // this is the only consent ask
    expect(message.toLowerCase()).toContain("only time we ask");
  });
});
