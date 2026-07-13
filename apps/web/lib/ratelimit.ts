import type { Store } from "./store/types";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

interface LimitRule {
  key: string;
  windowSeconds: number;
  max: number;
}

/**
 * Fixed-window limits. Genuine stuck-sessions are rare events per user, so
 * these are generous for real use and tight for abuse.
 *
 * `ip` MUST come from a trustworthy source (see lib/client-ip.ts) — the
 * per-IP rules are the primary gate, and `installId` (client-supplied) only
 * *adds* a stricter bucket, it never substitutes for IP limiting. The global
 * rule is a circuit-breaker that bounds total paid-LLM spend even against a
 * botnet rotating IPs; it is set well above expected legitimate volume.
 */
export async function checkRateLimit(
  store: Store,
  ip: string,
  installId?: string,
): Promise<RateLimitDecision> {
  const rules: LimitRule[] = [
    { key: "global-min", windowSeconds: MINUTE, max: 60 },
    { key: `ip-hour:${ip}`, windowSeconds: HOUR, max: 12 },
    { key: `ip-day:${ip}`, windowSeconds: DAY, max: 40 },
    ...(installId
      ? [{ key: `install-hour:${installId}`, windowSeconds: HOUR, max: 6 }]
      : []),
  ];

  for (const rule of rules) {
    const count = await store.incrWindow(rule.key, rule.windowSeconds);
    if (count > rule.max) {
      return { allowed: false, retryAfterSeconds: rule.windowSeconds };
    }
  }
  return { allowed: true };
}

/**
 * Throttles dashboard passcode attempts to defeat online brute force.
 * 10 attempts per 15 minutes per IP — ample for a fat-fingered operator,
 * far too few to brute a reasonable passcode.
 */
export async function checkLoginRateLimit(
  store: Store,
  ip: string,
): Promise<RateLimitDecision> {
  const windowSeconds = 15 * MINUTE;
  const count = await store.incrWindow(`login:${ip}`, windowSeconds);
  if (count > 10) return { allowed: false, retryAfterSeconds: windowSeconds };
  return { allowed: true };
}
