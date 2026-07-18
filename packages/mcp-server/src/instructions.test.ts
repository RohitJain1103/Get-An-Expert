import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "./index";

describe("INSTRUCTIONS", () => {
  it("must be under 2400 bytes (measured host truncation cap)", () => {
    const byteLength = Buffer.byteLength(INSTRUCTIONS, "utf8");
    expect(byteLength).toBeLessThan(2400);
  });

  it("contains the explicit-ask sentence about asking and following up", () => {
    expect(INSTRUCTIONS).toContain(
      "asks about this tool, or follows up on an earlier mention"
    );
  });
});
