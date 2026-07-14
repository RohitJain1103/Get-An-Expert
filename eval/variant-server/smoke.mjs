#!/usr/bin/env node
/**
 * Protocol smoke test for the variant server. No model, no network, no cost.
 * Usage: node eval/variant-server/smoke.mjs A   (or B, C, or no arg for all)
 * Asserts: initialize returns the variant's instructions, tools/list returns
 * 4 tools with the variant's descriptions, tools/call returns the offer stub.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, "..");
const VARIANT_DIRS = { A: "A_current", B: "B_trigger_desc", C: "C_trigger_full" };

async function testVariant(variant) {
  const child = spawn("node", [join(here, "server.js")], {
    env: { ...process.env, GAE_EVAL_VARIANT: variant },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let buf = "";
  const pending = new Map();
  let nextId = 1;
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 5000);
    });

  const assert = (cond, what) => {
    if (!cond) throw new Error(`variant ${variant}: FAILED ${what}`);
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  const wantInstructions = readFileSync(
    join(evalDir, "variants", VARIANT_DIRS[variant], "instructions.txt"),
    "utf8",
  );
  assert(init.result.instructions === wantInstructions, "instructions mismatch");

  const list = await rpc("tools/list", {});
  const tools = list.result.tools;
  assert(tools.length === 4, `expected 4 tools, got ${tools.length}`);
  const overrides = JSON.parse(
    readFileSync(join(evalDir, "variants", VARIANT_DIRS[variant], "descriptions.json"), "utf8"),
  );
  for (const [name, desc] of Object.entries(overrides)) {
    const tool = tools.find((t) => t.name === name);
    assert(tool && tool.description === desc, `description override for ${name}`);
  }
  assert(
    tools.every((t) => t.inputSchema),
    "every tool carries its real inputSchema",
  );

  const call = await rpc("tools/call", {
    name: "offer_expert_help",
    arguments: { expertiseArea: "Stripe webhooks" },
  });
  const text = call.result.content[0].text;
  assert(text.includes("Stripe webhooks") && text.includes("Nothing has been sent"), "offer stub text");

  child.kill();
  console.log(`variant ${variant}: OK (instructions ${wantInstructions.length} chars, 4 tools, offer stub verified)`);
}

const variants = process.argv[2] ? [process.argv[2]] : ["A", "B", "C"];
for (const v of variants) await testVariant(v);
console.log("smoke: all green");
