/**
 * Central env access. Read lazily (functions) so serverless runtimes pick up
 * values at request time and tests can stub process.env.
 */
export const env = {
  anthropicApiKey: (): string | null => process.env.ANTHROPIC_API_KEY ?? null,

  upstashUrl: (): string | null =>
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? null,

  upstashToken: (): string | null =>
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    null,

  dashboardPasscode: (): string | null =>
    process.env.DASHBOARD_PASSCODE ?? null,

  /** Name shown to users for dashboard-side chat messages. */
  expertDisplayName: (): string => process.env.EXPERT_DISPLAY_NAME ?? "Expert",

  /** Public base URL of this deployment, for deletion links. */
  publicBaseUrl: (): string =>
    process.env.PUBLIC_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),
};
