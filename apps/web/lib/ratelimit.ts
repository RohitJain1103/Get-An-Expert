import type { Store } from "./store/types";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

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
 */
export async function checkRateLimit(
  store: Store,
  ip: string,
  installId?: string,
): Promise<RateLimitDecision> {
  const rules: LimitRule[] = [
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
