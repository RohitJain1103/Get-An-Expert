#!/usr/bin/env node
/**
 * Eval variant server: an MCP stdio server that serves the REAL tool schemas
 * (eval/tool_defs.json, extracted verbatim from packages/mcp-server) with the
 * descriptions + server instructions of the variant named by GAE_EVAL_VARIANT
 * (A|B|C -> eval/variants/<dir>/). Every tool handler returns canned local
 * text: no network I/O exists anywhere in this file, so nothing can reach the
 * production API. Zero dependencies by design.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, "..");

const VARIANT_DIRS = {
  A: "A_current",
  B: "B_trigger_desc",
  C: "C_trigger_full",
};
const variant = process.env.GAE_EVAL_VARIANT ?? "A";
const variantDir = VARIANT_DIRS[variant];
if (!variantDir) {
  console.error(`[gae-eval] unknown GAE_EVAL_VARIANT=${variant}`);
  process.exit(1);
}

const defs = JSON.parse(readFileSync(join(evalDir, "tool_defs.json"), "utf8"));
const instructions = readFileSync(
  join(evalDir, "variants", variantDir, "instructions.txt"),
  "utf8",
);
const overrides = JSON.parse(
  readFileSync(join(evalDir, "variants", variantDir, "descriptions.json"), "utf8"),
);

// Real schemas, variant descriptions. Tools without an override keep the
// shipped description (A's descriptions.json lists all four explicitly).
const tools = defs.tools.map((t) => ({
  ...t,
  description: overrides[t.name] ?? t.description,
}));

/** Canned tool results. Local text only; mirrors the real server's shapes. */
function callTool(name, args) {
  switch (name) {
    case "offer_expert_help": {
      const area = args?.expertiseArea ?? "this problem";
      return (
        `I can connect you with a live human expert on ${area} through Get An Expert. ` +
        `If you agree, one structured summary of this stuck session (your goal, what was tried, ` +
        `error messages, tech stack; secrets redacted locally) is sent for a human expert to review, ` +
        `and a live human-to-human chat opens where the expert joins you. Nothing has been sent yet ` +
        `and nothing is ever sent without your explicit yes. Requests auto-delete after 30 days and ` +
        `can be deleted immediately anytime. Want me to set it up?`
      );
    }
    case "request_expert_help":
      if (!args?.userConfirmed) {
        return "[eval stub] Consent required: the user must explicitly agree after seeing the offer before anything is sent.";
      }
      return "[eval stub] Request accepted. A human expert will review the summary and join the chat shortly. (Eval mode: nothing was transmitted.)";
    case "check_expert_replies":
      return "No expert chat on record for this machine yet.";
    case "get_privacy_info":
      return (
        "Get An Expert data handling: nothing is sent anywhere until you explicitly agree to a specific request; " +
        "one structured summary (goal, attempts, errors, tech stack) is sent on yes, secrets redacted locally; " +
        "auto-deletes after 30 days. (Eval stub.)"
      );
    default:
      return null;
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, code, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id == null) return; // notification: nothing to do

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "get-an-expert-eval", version: `0.0.0-eval-${variant}` },
        instructions,
      });
      break;
    case "tools/list":
      reply(id, { tools });
      break;
    case "tools/call": {
      const text = callTool(params?.name, params?.arguments);
      if (text == null) {
        replyError(id, -32602, `unknown tool: ${params?.name}`);
      } else {
        reply(id, { content: [{ type: "text", text }] });
      }
      break;
    }
    case "ping":
      reply(id, {});
      break;
    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
});

console.error(`[gae-eval] variant server ready (variant ${variant}, ${tools.length} tools)`);
