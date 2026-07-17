/**
 * ICE server configuration served to the dashboard so peer-to-peer WebRTC can
 * fall back to a TURN relay when a direct connection can't be made.
 *
 * Why: files + terminal ride a P2P WebRTC link. With STUN only, the two machines
 * must reach each other directly, which a symmetric NAT or strict firewall
 * blocks — the file explorer stays "Not loaded yet" and the terminal is dead
 * (verified: it's the network path, not the code). A TURN relay fixes it. TURN
 * on the expert's browser alone is enough: its relay candidate is a public
 * address the customer's machine can always reach, so no agent change is needed.
 *
 * Credentials live ONLY in the relay's environment. The dashboard fetches this
 * list from `/api/ice` at connect time, so nothing sensitive ships in the static
 * bundle or the published agent.
 */

/** Browser-shaped RTCIceServer — consumed directly by the dashboard. */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Public STUN baseline, always present (previous behavior). */
export const DEFAULT_STUN = "stun:stun.l.google.com:19302";

/** Cloudflare short-lived creds are cached until shortly before they expire so
 * we don't hit their API on every connect. Refreshed lazily on the next call. */
let cfCache: { servers: IceServerConfig[]; expiresAt: number } | undefined;
const CF_TTL_SECONDS = 86_400; // 24h — Cloudflare's max
const CF_REFRESH_SKEW_MS = 5 * 60_000; // refresh 5min before expiry

/**
 * Resolve the ICE server list. Priority:
 *   1. GET_AN_EXPERT_ICE_SERVERS — full JSON array of RTCIceServer objects (verbatim).
 *   2. Cloudflare Realtime TURN — GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID +
 *      _CLOUDFLARE_TURN_API_TOKEN; the relay mints short-lived credentials.
 *   3. A single static TURN provider — GET_AN_EXPERT_TURN_URLS/_USERNAME/_CREDENTIAL
 *      (Metered, Twilio, self-hosted coturn), appended after the STUN baseline.
 *   4. STUN only when nothing is configured (identical to the old behavior).
 */
export async function iceServers(env: NodeJS.ProcessEnv = process.env): Promise<IceServerConfig[]> {
  const override = env.GET_AN_EXPERT_ICE_SERVERS?.trim();
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as IceServerConfig[];
    } catch {
      // malformed — fall through
    }
  }

  const cfKeyId = env.GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID?.trim();
  const cfToken = env.GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (cfKeyId && cfToken) {
    const servers = await cloudflareIceServers(cfKeyId, cfToken);
    if (servers) return servers;
    // Cloudflare unreachable — fall through to STUN so a session is never blocked.
  }

  const servers: IceServerConfig[] = [{ urls: DEFAULT_STUN }];
  const urls = env.GET_AN_EXPERT_TURN_URLS?.trim();
  const username = env.GET_AN_EXPERT_TURN_USERNAME?.trim();
  const credential = env.GET_AN_EXPERT_TURN_CREDENTIAL?.trim();
  if (urls && username && credential) {
    const list = urls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (list.length > 0) {
      servers.push({ urls: list.length === 1 ? list[0] : list, username, credential });
    }
  }
  return servers;
}

/**
 * Mint (or reuse cached) short-lived TURN credentials from Cloudflare Realtime.
 * Returns the browser-shaped iceServers array Cloudflare already produces (STUN
 * + TURN entries), or undefined on any failure so the caller can fall back.
 */
async function cloudflareIceServers(
  keyId: string,
  apiToken: string,
): Promise<IceServerConfig[] | undefined> {
  const now = Date.now();
  if (cfCache && cfCache.expiresAt > now) return cfCache.servers;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  (timer as { unref?: () => void }).unref?.();
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: CF_TTL_SECONDS }),
        signal: controller.signal,
      },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { iceServers?: IceServerConfig[] };
    const servers = Array.isArray(data.iceServers) ? data.iceServers : undefined;
    if (!servers || servers.length === 0) return undefined;
    cfCache = { servers, expiresAt: now + CF_TTL_SECONDS * 1000 - CF_REFRESH_SKEW_MS };
    return servers;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook: clear the Cloudflare credential cache. */
export function _resetIceCache(): void {
  cfCache = undefined;
}
