import { describe, expect, it } from "vitest";
import { clientIp } from "../lib/client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("prefers the platform-set x-real-ip", () => {
    expect(
      clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("203.0.113.7");
  });

  it("ignores a spoofed FIRST x-forwarded-for entry, trusting the LAST hop", () => {
    // Attacker prepends a fake IP; the platform-appended real IP is last.
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("cannot be made unique per request by spoofing XFF (same real hop)", () => {
    const a = clientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }));
    const b = clientIp(h({ "x-forwarded-for": "5.6.7.8, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("falls back to a stable sentinel when no IP header is present", () => {
    expect(clientIp(h({}))).toBe("unknown");
  });
});
