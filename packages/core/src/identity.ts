import { userInfo } from "node:os";

/**
 * Resolves how to display this requester to the expert. Same precedence the
 * on-machine agent already uses for its live session queue (packages/agent
 * customerName()), reused here so an async request gets the same identity
 * an expert would already see in a live walk-away session: an explicit
 * override (the user told their agent to use a different name) wins, then
 * GET_AN_EXPERT_CUSTOMER_NAME, then the OS account username. Undefined only
 * when none of those produced anything usable.
 */
export function resolveRequesterName(explicit?: string): string | undefined {
  const trimmedExplicit = explicit?.trim();
  if (trimmedExplicit) return trimmedExplicit;

  const fromEnv = process.env.GET_AN_EXPERT_CUSTOMER_NAME?.trim();
  if (fromEnv) return fromEnv;

  try {
    const name = userInfo().username?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
