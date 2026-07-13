/**
 * Best-effort client IP for rate limiting.
 *
 * SECURITY: never trust the client-suppliable *first* `X-Forwarded-For` entry.
 * On Vercel the platform sets `x-real-ip` to the true connecting IP and appends
 * that IP as the *last* XFF entry, so taking `x-real-ip` (or the last XFF hop)
 * prevents an attacker from minting a fresh rate-limit bucket per request by
 * spoofing `X-Forwarded-For`.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}
