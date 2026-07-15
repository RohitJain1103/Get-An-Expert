import { userInfo } from "node:os";
import { resolve } from "node:path";

export const SERVER_NAME = "get-an-expert-agent";
export const SERVER_VERSION = "0.1.0";

/** Default hosted relay — used when GET_AN_EXPERT_RELAY_URL is not set, so
 * users need no configuration. Override with the env var for local dev
 * (ws://localhost:8787) or a self-hosted relay. */
const DEFAULT_RELAY_URL = "wss://get-an-expert-relay-production.up.railway.app";

/** Relay to register with. */
export function relayUrl(): string {
  return process.env.GET_AN_EXPERT_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
}

/** Project directory the expert is scoped to. */
export function projectDir(override?: string): string {
  const dir = override?.trim() || process.env.GET_AN_EXPERT_PROJECT_DIR?.trim() || process.cwd();
  return resolve(dir);
}

/** Display name shown to the expert in the queue. */
export function customerName(): string {
  const fromEnv = process.env.GET_AN_EXPERT_CUSTOMER_NAME?.trim();
  if (fromEnv) return fromEnv;
  try {
    return userInfo().username || "Anonymous";
  } catch {
    return "Anonymous";
  }
}

/** Default dev-server port offered for the Browser scope. */
export function defaultBrowserPort(): number {
  const raw = process.env.GET_AN_EXPERT_BROWSER_PORT;
  const port = raw ? Number(raw) : 3000;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000;
}
