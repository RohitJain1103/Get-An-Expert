import type { IceServer, RtcConfig } from "node-datachannel";

/**
 * ICE server resolution for the agent's peer connection.
 *
 * The relay serves browser-shaped RTCIceServer objects (what the dashboard
 * uses) at `/api/ice`. node-datachannel wants a different shape: `"stun:host:port"`
 * strings, or `{ hostname, port, username, password, relayType }` for TURN.
 * This module fetches that list and converts it, so a single relay env config
 * drives both clients. TURN credentials never ship inside the published agent.
 *
 * Everything here is best-effort: any failure (old relay without the endpoint,
 * network error, timeout) resolves to the public STUN server, which is exactly
 * the previous behavior — never worse than before.
 */

/** A browser-shaped RTCIceServer, as served by the relay's /api/ice. */
interface BrowserIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_STUN = "stun:stun.l.google.com:19302";
const DEFAULT_ICE: RtcConfig["iceServers"] = [DEFAULT_STUN];
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch and convert the relay's ICE server list for node-datachannel. Resolves
 * to the public STUN server on any failure. The abort timer is unref'd so a
 * slow relay can never keep a process (or a test worker) alive.
 */
export async function fetchIceServers(relayUrl: string): Promise<RtcConfig["iceServers"]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Node's Timeout has unref(); guard for non-Node runtimes just in case.
  (timer as { unref?: () => void }).unref?.();
  try {
    const origin = new URL(relayUrl.trim().replace(/^ws/, "http")).origin;
    const res = await fetch(`${origin}/api/ice`, { signal: controller.signal });
    if (!res.ok) return DEFAULT_ICE;
    const data = (await res.json()) as { iceServers?: BrowserIceServer[] };
    const converted = toNodeIceServers(data.iceServers ?? []);
    return converted.length > 0 ? converted : DEFAULT_ICE;
  } catch {
    return DEFAULT_ICE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert browser RTCIceServer objects to node-datachannel ICE entries. STUN
 * servers become plain "stun:host:port" strings; TURN/TURNS servers become
 * structured objects carrying the credentials and the right relay transport.
 */
export function toNodeIceServers(servers: BrowserIceServer[]): (string | IceServer)[] {
  const out: (string | IceServer)[] = [];
  for (const server of servers) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const url of urls) {
      const parsed = parseIceUrl(url);
      if (!parsed) continue;
      if (parsed.scheme === "stun" || parsed.scheme === "stuns") {
        out.push(`${parsed.scheme}:${parsed.host}:${parsed.port}`);
      } else {
        out.push({
          hostname: parsed.host,
          port: parsed.port,
          username: server.username,
          password: server.credential,
          relayType:
            parsed.scheme === "turns"
              ? "TurnTls"
              : parsed.transport === "tcp"
                ? "TurnTcp"
                : "TurnUdp",
        });
      }
    }
  }
  return out;
}

interface ParsedIceUrl {
  scheme: "stun" | "stuns" | "turn" | "turns";
  host: string;
  port: number;
  transport?: "udp" | "tcp";
}

/**
 * Parse an ICE URL of the form `scheme:host[:port][?transport=udp|tcp]`.
 * Ports default to 3478 (stun/turn) or 5349 (stuns/turns). Returns null for
 * anything that isn't a recognized ICE URL.
 */
export function parseIceUrl(url: string): ParsedIceUrl | null {
  const trimmed = url.trim();
  const firstColon = trimmed.indexOf(":");
  if (firstColon === -1) return null;
  const scheme = trimmed.slice(0, firstColon).toLowerCase();
  if (scheme !== "stun" && scheme !== "stuns" && scheme !== "turn" && scheme !== "turns") {
    return null;
  }

  let rest = trimmed.slice(firstColon + 1);
  let transport: "udp" | "tcp" | undefined;
  const q = rest.indexOf("?");
  if (q !== -1) {
    const match = /transport=(udp|tcp)/i.exec(rest.slice(q + 1));
    if (match) transport = match[1].toLowerCase() as "udp" | "tcp";
    rest = rest.slice(0, q);
  }

  const secure = scheme === "stuns" || scheme === "turns";
  let host = rest;
  let port = secure ? 5349 : 3478;
  const lastColon = rest.lastIndexOf(":");
  if (lastColon !== -1) {
    const maybePort = Number(rest.slice(lastColon + 1));
    if (Number.isInteger(maybePort) && maybePort > 0 && maybePort < 65536) {
      host = rest.slice(0, lastColon);
      port = maybePort;
    }
  }
  if (!host) return null;
  return { scheme, host, port, transport };
}
