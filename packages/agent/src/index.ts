#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentSession } from "./agent-session";
import {
  SERVER_NAME,
  SERVER_VERSION,
  customerName,
  defaultBrowserPort,
  projectDir,
  relayUrl,
} from "./config";
import type { Grant } from "./permissions";
import { cleanupWebrtc } from "./webrtc/peer";

/**
 * The customer-facing MCP server. It runs inside the customer's own AI coding
 * tool (Claude Code, Codex, Cursor, Windsurf) over stdio. Everything the
 * customer does — asking for an expert, approving scopes, watching activity,
 * revoking access, ending the session — happens inline in their existing chat.
 *
 * The expert never talks to this server. The expert connects peer-to-peer to
 * the agent's OTHER MCP surface (see expert-server.ts) over WebRTC.
 */
const INSTRUCTIONS = `Get An Expert brings a real human expert onto the user's machine to fix a bug, through scoped, consent-based access. The expert works in the user's own project directory — reading files, running commands, checking the browser — and the user sees a live log of every action and can revoke any scope at any time.

When the user asks for a human expert (or runs /get-an-expert), call request_expert_help. That tool asks the user, inline, to approve three scopes — Files, Terminal, and Browser — before anyone connects; relay its result verbatim. After an expert is requested, use expert_status to tell the user whether an expert has joined and what they have done so far (the live activity log). If the user wants to withdraw a scope, call revoke_access; when they're done, call end_session and relay the summary. Never grant or revoke on the user's behalf without them asking.`;

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { instructions: INSTRUCTIONS },
);

/** One live session per process. */
let session: AgentSession | undefined;

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

/* ── /get-an-expert slash command ─────────────────────────────────────────── */

server.registerPrompt(
  "get-an-expert",
  {
    title: "Get an expert on your machine",
    description:
      "Bring a real human expert into this session to fix what you're stuck on. They work on your machine through scoped, revocable access.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "I'm stuck and want a human expert to help. Call the request_expert_help tool so I can approve access and get connected.",
        },
      },
    ],
  }),
);

/* ── request_expert_help ──────────────────────────────────────────── */

server.registerTool(
  "request_expert_help",
  {
    title: "Request a human expert",
    description:
      "Registers a help session and asks the user, inline, to approve the scopes an expert may use on their machine (Files, Terminal, Browser). Nothing is granted until the user approves.",
    inputSchema: {
      issue: z
        .string()
        .max(2000)
        .optional()
        .describe("Short description of what the user is stuck on, from this conversation."),
      projectDir: z
        .string()
        .max(500)
        .optional()
        .describe("Absolute path to scope the expert to. Defaults to the launch directory."),
      browserPort: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Localhost dev-server port to scope Browser access to. Defaults to 3000."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ issue, projectDir: dirArg, browserPort }) => {
    if (session && session.state !== "ended" && session.state !== "idle") {
      return text(
        `A Get An Expert session is already active (state: ${session.state}). Use expert_status to check on it, or end_session to close it first.`,
      );
    }

    const dir = projectDir(dirArg);
    const port = browserPort ?? defaultBrowserPort();
    session = new AgentSession({
      relayUrl: relayUrl(),
      projectDir: dir,
      customerName: customerName(),
      log: (line) => console.error(`[get-an-expert] ${line}`),
    });

    // Register with the relay first so the request is queued for experts.
    let sessionId: string;
    try {
      ({ sessionId } = await session.requestExpert(issue));
    } catch (err) {
      session = undefined;
      return text(
        `Could not reach the Get An Expert relay at ${relayUrl()}. Is it running? (${errText(err)})`,
      );
    }

    // Ask the user, inline, to approve the scopes.
    const grant = await elicitScopes(dir, port);
    if (!grant) {
      await session.end("consent declined");
      session = undefined;
      return text(
        "No access was granted, so the request was cancelled. Nothing runs on your machine without your approval.",
      );
    }
    session.grant(grant);

    return json({
      status: "waiting-for-expert",
      sessionId,
      projectDir: dir,
      granted: grant,
      message:
        "You're in the expert queue. The moment an expert joins they can act only within the scopes you approved, and you'll see every action. Call expert_status to check whether they've connected. You can revoke_access or end_session at any time.",
    });
  },
);

/* ── expert_status ────────────────────────────────────────────────── */

server.registerTool(
  "expert_status",
  {
    title: "Check the expert session",
    description:
      "Reports whether an expert has connected, the currently approved scopes, and the live log of everything the expert has done on this machine.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    if (!session || session.state === "idle") {
      return text("No Get An Expert session is active. Call request_expert_help to start one.");
    }
    return json(session.status());
  },
);

/* ── revoke_access ────────────────────────────────────────────────── */

server.registerTool(
  "revoke_access",
  {
    title: "Revoke expert access",
    description:
      "Immediately revokes a scope (files, terminal, or browser) or all of them. Takes effect before the expert's next action.",
    inputSchema: {
      scope: z
        .enum(["files", "terminal", "browser", "all"])
        .describe("Which scope to revoke, or 'all'."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ scope }) => {
    if (!session || session.state === "ended" || session.state === "idle") {
      return text("No active Get An Expert session to revoke access from.");
    }
    const permissions = session.revoke(scope);
    return json({ revoked: scope, permissions });
  },
);

/* ── end_session ──────────────────────────────────────────────────── */

server.registerTool(
  "end_session",
  {
    title: "End the expert session",
    description:
      "Ends the session, revokes all expert access, and returns a summary of what changed (files modified, commands run, duration).",
    inputSchema: {},
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async () => {
    if (!session || session.state === "idle") {
      return text("No Get An Expert session is active.");
    }
    const summary = await session.end();
    session = undefined;
    return json({ status: "ended", summary });
  },
);

/**
 * Ask the user to approve the three scopes, inline, via MCP elicitation.
 * Returns the granted scopes, or undefined if the host has no elicitation or
 * the user declined everything. Fails closed.
 */
async function elicitScopes(dir: string, port: number): Promise<Grant | undefined> {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    // No inline prompt available: do not silently grant anything.
    return undefined;
  }
  try {
    const result = await server.server.elicitInput({
      message:
        `An expert wants to help on your machine. Approve what they can do — ` +
        `everything is scoped to ${dir}, logged live, and revocable anytime:`,
      requestedSchema: {
        type: "object",
        properties: {
          files: {
            type: "boolean",
            title: `Read & edit files in ${dir}`,
            default: true,
          },
          terminal: {
            type: "boolean",
            title: `Run terminal commands in ${dir}`,
            default: true,
          },
          browser: {
            type: "boolean",
            title: `View the browser at localhost:${port}`,
            default: true,
          },
        },
        required: ["files", "terminal", "browser"],
      },
    });
    if (result.action !== "accept" || !result.content) return undefined;
    const files = result.content.files === true;
    const terminal = result.content.terminal === true;
    const browser = result.content.browser === true;
    if (!files && !terminal && !browser) return undefined;
    const grant: Grant = { files, terminal, browser };
    if (browser) grant.browserPort = port;
    return grant;
  } catch {
    return undefined;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[get-an-expert] agent ready (relay: ${relayUrl()})`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    try {
      cleanupWebrtc();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`[get-an-expert] fatal: ${errText(err)}`);
  process.exit(1);
});
