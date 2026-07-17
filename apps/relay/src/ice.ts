/**
 * ICE server configuration served to the dashboard and the agent so that
 * peer-to-peer WebRTC can fall back to a TURN relay when a customer's network
 * blocks a direct connection.
 *
 * Why this exists: with STUN only, the browser and the customer's machine try
 * to connect directly. Behind a symmetric NAT or a strict corporate firewall
 * that hole-punch fails, so no data channels open — the file explorer stays
 * "Not loaded yet" and the terminal is dead — even though the relay-based
 * control channel still shows the session as connected. A TURN server relays
 * the media when direct fails, which fixes those networks.
 *
 * Credentials live ONLY in the relay's environment. The dashboard fetches this
 * list at connect time and the agent fetches it before creating its peer, so
 * TURN credentials never ship in the static dashboard bundle or the published
 * npm agent, and can be rotated by restarting the relay alone.
 */

/**
 * A browser-shaped RTCIceServer. The dashboard consumes these objects directly;
 * the agent converts them to node-datachannel's own shape (see the agent's
 * webrtc/ice.ts).
 */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Public STUN server, always included as the baseline (previous behavior). */
export const DEFAULT_STUN = "stun:stun.l.google.com:19302";

/**
 * Build the ICE server list from the environment.
 *
 * Priority:
 *   1. `GET_AN_EXPERT_ICE_SERVERS` — a full JSON array of RTCIceServer objects.
 *      Escape hatch for multi-server or non-standard setups; used verbatim when
 *      it parses to a non-empty array.
 *   2. `GET_AN_EXPERT_TURN_URLS` (comma-separated) + `GET_AN_EXPERT_TURN_USERNAME`
 *      + `GET_AN_EXPERT_TURN_CREDENTIAL` — convenience for a single TURN
 *      provider (Cloudflare, Metered, Twilio, self-hosted coturn). Appended
 *      after the STUN baseline.
 *   3. STUN only when nothing is configured — identical to the old behavior, so
 *      an unconfigured relay is never worse than before.
 */
export function iceServers(env: NodeJS.ProcessEnv = process.env): IceServerConfig[] {
  const override = env.GET_AN_EXPERT_ICE_SERVERS?.trim();
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as IceServerConfig[];
      }
    } catch {
      // Malformed override — fall through to the convenience vars / default
      // rather than serving an empty list.
    }
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
