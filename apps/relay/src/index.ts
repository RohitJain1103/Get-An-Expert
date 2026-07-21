#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLeadStore } from "./leads";
import { createPersistence } from "./persistence";
import { DEFAULT_ACTIVE_GRACE_MS, DEFAULT_MAX_AGE_MS, createRelay } from "./server";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

/** How long a queued request lives before the max-age sweep expires it. */
function resolveMaxAgeMs(): number {
  const raw = process.env.GET_AN_EXPERT_SESSION_MAX_AGE_MS;
  if (!raw) return DEFAULT_MAX_AGE_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_MAX_AGE_MS;
}

/** Grace window before a dropped socket releases an active session's claim. */
function resolveActiveGraceMs(): number {
  const raw = process.env.GET_AN_EXPERT_ACTIVE_GRACE_MS;
  if (!raw) return DEFAULT_ACTIVE_GRACE_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_ACTIVE_GRACE_MS;
}

// Bind to loopback by default. The relay can grant terminal/file access to a
// customer's machine, so it must not be reachable from the network unless the
// operator opts in (GET_AN_EXPERT_HOST=0.0.0.0) behind their own auth/firewall.
const host = process.env.GET_AN_EXPERT_HOST?.trim() || "127.0.0.1";

/** Expert tokens from env, or a generated one printed at startup. */
function resolveExpertTokens(): { tokens: string[]; generated?: string } {
  const raw = process.env.GET_AN_EXPERT_EXPERT_TOKENS;
  if (raw) {
    const tokens = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length > 0) return { tokens };
  }
  const generated = randomBytes(16).toString("hex");
  return { tokens: [generated], generated };
}

/** Locate the dashboard static files (env override, then sibling package). */
function resolveDashboardDir(): string | undefined {
  if (process.env.GET_AN_EXPERT_DASHBOARD_DIR) {
    const dir = resolve(process.env.GET_AN_EXPERT_DASHBOARD_DIR);
    return existsSync(dir) ? dir : undefined;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "dashboard", "public"), // from dist/ or src/
    join(here, "..", "..", "..", "apps", "dashboard", "public"),
  ];
  return candidates.find((c) => existsSync(c));
}

const { tokens, generated } = resolveExpertTokens();
const dashboardDir = resolveDashboardDir();
const leads = createLeadStore(process.env, (line) => console.log(`[relay] ${line}`));

const relay = createRelay({
  expertTokens: tokens,
  dashboardDir,
  persistence: createPersistence(resolveMaxAgeMs(), (line) =>
    console.log(`[relay] ${line}`),
  ),
  leads,
  maxAgeMs: resolveMaxAgeMs(),
  activeGraceMs: resolveActiveGraceMs(),
  log: (line) => console.log(`[relay] ${line}`),
});

// Restore any queued requests that survived a restart before accepting traffic,
// so experts see the backlog the moment they connect.
await relay.hydrate();

relay.server.listen(port, host, () => {
  console.log(`[relay] Get An Expert relay listening on http://${host}:${port}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      `[relay] WARNING: bound to ${host} — reachable from the network. Ensure experts are authenticated and the port is firewalled.`,
    );
  }
  console.log(
    dashboardDir
      ? `[relay] Serving expert dashboard from ${dashboardDir}`
      : "[relay] No dashboard dir found — static serving disabled (set GET_AN_EXPERT_DASHBOARD_DIR)",
  );
  if (generated) {
    console.log(
      `[relay] No GET_AN_EXPERT_EXPERT_TOKENS set. Generated expert token for this run:\n[relay]   ${generated}`,
    );
  }
  console.log(`[relay] Leads: ${leads.describe()}`);
  console.log(
    "[relay] Signaling only: file contents, terminal output, and browser data flow peer-to-peer and never touch this server.",
  );
});
