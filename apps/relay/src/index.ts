#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./server";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
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
    join(here, "..", "..", "get-an-expert-dashboard", "public"), // from dist/ or src/
    join(here, "..", "..", "..", "get-an-expert-dashboard", "public"),
  ];
  return candidates.find((c) => existsSync(c));
}

const { tokens, generated } = resolveExpertTokens();
const dashboardDir = resolveDashboardDir();

const relay = createRelay({
  expertTokens: tokens,
  dashboardDir,
  log: (line) => console.log(`[relay] ${line}`),
});

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
  console.log(
    "[relay] Signaling only: file contents, terminal output, and browser data flow peer-to-peer and never touch this server.",
  );
});
