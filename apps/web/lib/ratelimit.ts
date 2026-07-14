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

/**
 * Posting on a thread, IP-scoped part. Runs BEFORE token auth — it must not
 * consume any per-thread budget, or an attacker who merely knows a request id
 * could lock the real participants out (ids appear in delete URLs).
 */
export async function checkThreadWriteRateLimit(
  store: Store,
  ip: string,
): Promise<RateLimitDecision> {
  const rules: LimitRule[] = [
    { key: `msg-ip-min:${ip}`, windowSeconds: MINUTE, max: 20 },
    { key: `msg-ip-hour:${ip}`, windowSeconds: HOUR, max: 120 },
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
 * Per-thread budget. Only call AFTER the thread token has been verified, so
 * unauthenticated garbage can never exhaust a real thread's quota.
 */
export async function checkThreadQuota(
  store: Store,
  requestId: string,
): Promise<RateLimitDecision> {
  const count = await store.incrWindow(`msg-thread-hour:${requestId}`, HOUR);
  if (count > 60) return { allowed: false, retryAfterSeconds: HOUR };
  return { allowed: true };
}

/**
 * Reading a thread: sized for the companion plugin's poll (~1/min per
 * session) with headroom for manual checks.
 */
export async function checkThreadReadRateLimit(
  store: Store,
  ip: string,
): Promise<RateLimitDecision> {
  const count = await store.incrWindow(`msg-read-ip-min:${ip}`, MINUTE);
  if (count > 30) return { allowed: false, retryAfterSeconds: MINUTE };
  return { allowed: true };
}
