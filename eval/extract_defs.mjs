#!/usr/bin/env node
/**
 * One-time extraction: launches the REAL mcp-server (source, via tsx), speaks
 * MCP JSON-RPC over its stdio, and writes:
 *   eval/tool_defs.json                      - verbatim tools/list + instructions + provenance
 *   eval/variants/A_current/instructions.txt - server instructions verbatim
 *   eval/variants/A_current/descriptions.json- current tool descriptions verbatim
 *
 * Rerun after any change to packages/mcp-server to refresh the baseline.
 */
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalDir, "..");

const child = spawn(
  "pnpm",
  ["--filter", "get-an-expert-mcp", "exec", "tsx", "src/index.ts"],
  { cwd: repoRoot, stdio: ["pipe", "pipe", "inherit"] },
);

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 20000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "gae-eval-extractor", version: "0.0.0" },
});
notify("notifications/initialized", {});
const { tools } = await rpc("tools/list", {});
child.kill();

const sourceCommit = execSync("git rev-parse HEAD", { cwd: repoRoot })
  .toString()
  .trim();

const out = {
  sourceCommit,
  serverName: init.serverInfo?.name,
  serverVersion: init.serverInfo?.version,
  protocolVersion: init.protocolVersion,
  extractedAt: new Date().toISOString(),
  instructions: init.instructions ?? "",
  tools,
};

writeFileSync(join(evalDir, "tool_defs.json"), JSON.stringify(out, null, 2) + "\n");

const aDir = join(evalDir, "variants", "A_current");
mkdirSync(aDir, { recursive: true });
writeFileSync(join(aDir, "instructions.txt"), out.instructions);
const descriptions = Object.fromEntries(tools.map((t) => [t.name, t.description]));
writeFileSync(join(aDir, "descriptions.json"), JSON.stringify(descriptions, null, 2) + "\n");

console.log(`extracted ${tools.length} tools @ ${sourceCommit.slice(0, 7)}`);
console.log(tools.map((t) => t.name).join(", "));
