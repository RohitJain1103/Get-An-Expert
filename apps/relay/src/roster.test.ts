import { describe, expect, it } from "vitest";
import { ROSTER, findExpert } from "./roster";

describe("roster", () => {
  it("has six experts in the approved order", () => {
    expect(ROSTER.map((e) => e.id)).toEqual([
      "rohit", "aakash", "senjal", "inigo", "hardik", "pulkit",
    ]);
  });
  it("findExpert returns a profile by id and undefined for unknowns", () => {
    expect(findExpert("inigo")?.name).toBe("Iñigo Fernández");
    expect(findExpert("inigo")?.rating).toBe(4.8);
    expect(findExpert("inigo")?.fixesDelivered).toBe(6);
    expect(findExpert("nobody")).toBeUndefined();
  });
  it("never contains anything secret-shaped", () => {
    const json = JSON.stringify(ROSTER);
    // "code" is intentionally excluded from the secret words: it collides with
    // Rohit's locked marketing tag "Code, payments & APIs". The real guarantee
    // that no expert token or join code leaks into a public payload is proven
    // against the configured token in server.test.ts (R4 bench test).
    expect(json).not.toMatch(/token|secret|password/i);
  });
});
