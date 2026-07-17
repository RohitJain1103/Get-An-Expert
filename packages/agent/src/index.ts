#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearResume, readResume } from "@get-an-expert/core/relay";
import { AgentSession } from "./agent-session";
import {
  SERVER_NAME,
  SERVER_VERSION,
  autoResume,
  customerName,
  defaultBrowserPort,
  projectDir,
  relayUrl,
  sessionMaxAgeMs,
} from "./config";
import {
  buildContextMarkdown,
  readProjectOverview,
  readTranscriptPointer,
  readTranscriptTail,
  transcriptToMarkdown,
  type ProjectOverview,
} from "./context";
import {
  END_SESSION_MESSAGE,
  EXPERT_WORK_GUIDANCE,
  queueMessage,
  statusMessage,
} from "./messages";
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

When the user asks for a human expert (or runs /get-an-expert), call request_expert_help. That tool asks the user, inline, to approve three scopes — Files, Terminal, and Browser — before anyone connects; relay its result verbatim. After an expert is requested, use expert_status to tell the user whether an expert has joined and what they have done so far (the live activity log). If the user wants to withdraw a scope, call revoke_access; when they're done, call end_session and relay the summary. Never grant or revoke on the user's behalf without them asking.

When you report status or the final summary, relay what the expert did or delivered — do not review, grade, or second-guess their work. The expert is a vetted human professional working with context you don't have; critiquing their in-progress or finished work confuses the user and is usually wrong. Only evaluate the expert's work if the user explicitly asks you to.

Once the request is queued, tell the user plainly: they can walk away — the request stays in the queue even if their connection drops or they restart their editor, and reconnects automatically (re-arming the scopes they approved, within a bounded window), so it is never lost while no expert is online. Keeping the machine on and awake lets the expert actually work; every action is logged, and expert_status shows where things stand whenever they check back. If a chat link is returned, pass it on so they can message the expert from their phone or any browser.`;

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

/**
 * Like json(), but adds a second block reminding the assistant to report the
 * expert's work rather than review it. Used only when there is real expert
 * activity or a delivered summary — the moments the assistant tends to slip
 * into critiquing a human it can't fully see.
 */
function jsonWithGuidance(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
      { type: "text" as const, text: EXPERT_WORK_GUIDANCE },
    ],
  };
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
      summary: z
        .string()
        .max(4000)
        .describe(
          "Hand-off notes for the human expert, written from this conversation: what the user is trying to do, the exact error or wrong behavior (quote it), what has been tried and why each attempt failed, which files/commands are involved, and how to run the app and its tests (plus any test login details the expert will need). Be specific — this is the first thing the expert reads.",
        ),
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
  async ({ issue, summary, projectDir: dirArg, browserPort }) => {
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
    const consent = await elicitScopes(dir, port);
    if (!consent) {
      await session.end("consent declined");
      session = undefined;
      return text(
        "No access was granted, so the request was cancelled. Nothing runs on your machine without your approval.",
      );
    }
    session.grant(consent.grant);

    // Hand-off context for the expert — local + peer-to-peer only, and never
    // allowed to block the request: any failure degrades the file instead.
    const context = await writeSessionContext(session, {
      issue,
      summary,
      projectDir: dir,
      shareTranscript: consent.shareTranscript,
    });

    const chatUrl = session.chatUrl;
    return json({
      status: "waiting-for-expert",
      sessionId,
      chatUrl,
      projectDir: dir,
      granted: consent.grant,
      context,
      message: queueMessage(chatUrl),
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
    const payload = {
      message: statusMessage(session.state, session.expertName),
      chatUrl: session.chatUrl,
      ...session.status(),
    };
    // Only steer the assistant away from reviewing once an expert is actually
    // working — before that there's nothing to critique.
    return session.state === "connected" ? jsonWithGuidance(payload) : json(payload);
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
    return jsonWithGuidance({ status: "ended", message: END_SESSION_MESSAGE, summary });
  },
);

/** What the user approved inline: the revocable scopes, plus the one-time
 * consent to share this conversation as context (not part of the Grant —
 * it's a disclosure decision, not a revocable scope). */
interface ScopeConsent {
  grant: Grant;
  shareTranscript: boolean;
}

/**
 * Ask the user to approve the three scopes (plus conversation sharing),
 * inline, via MCP elicitation. Returns the consent, or undefined if the host
 * has no elicitation or the user declined everything. Fails closed.
 */
async function elicitScopes(dir: string, port: number): Promise<ScopeConsent | undefined> {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    // No inline prompt available: do not silently grant anything.
    return undefined;
  }
  try {
    const result = await server.server.elicitInput({
      message:
        `An expert wants to help, scoped to ${dir} — logged live, revocable anytime. Approve:`,
      requestedSchema: {
        type: "object",
        properties: {
          files: {
            type: "boolean",
            title: "Read & edit files",
            default: true,
          },
          terminal: {
            type: "boolean",
            title: "Run terminal commands",
            default: true,
          },
          browser: {
            type: "boolean",
            title: `View browser (localhost:${port})`,
            default: true,
          },
          conversation: {
            type: "boolean",
            title: "Share this conversation as context",
            default: true,
          },
        },
        required: ["files", "terminal", "browser", "conversation"],
      },
    });
    if (result.action !== "accept" || !result.content) return undefined;
    const files = result.content.files === true;
    const terminal = result.content.terminal === true;
    const browser = result.content.browser === true;
    if (!files && !terminal && !browser) return undefined;
    const grant: Grant = { files, terminal, browser };
    if (browser) grant.browserPort = port;
    return { grant, shareTranscript: result.content.conversation === true };
  } catch {
    return undefined;
  }
}

/**
 * Assemble and write the expert's CONTEXT.md: the agent's hand-off summary,
 * the consented conversation transcript (when the hook-written pointer is
 * fresh), and the project overview. Every step is best-effort — a failure
 * degrades the file to summary-only and never blocks the expert request.
 * Returns a short note for the tool result describing what was written.
 */
async function writeSessionContext(
  activeSession: AgentSession,
  input: {
    issue: string | undefined;
    summary: string;
    projectDir: string;
    shareTranscript: boolean;
  },
): Promise<string> {
  let transcriptMarkdown: string | undefined;
  if (input.shareTranscript) {
    try {
      const pointer = readTranscriptPointer();
      if (pointer) {
        transcriptMarkdown =
          transcriptToMarkdown(readTranscriptTail(pointer.transcriptPath)) || undefined;
      }
    } catch {
      // transcript unavailable — degrade to summary-only
    }
  }
  let overview: ProjectOverview | null = null;
  try {
    overview = readProjectOverview(input.projectDir);
  } catch {
    overview = null;
  }
  try {
    const markdown = buildContextMarkdown({
      customerName: customerName(),
      issue: input.issue,
      summary: input.summary,
      overview,
      transcriptMarkdown,
      requestedAt: Date.now(),
    });
    await activeSession.writeContext(markdown);
  } catch {
    return "not written — the expert will start from the issue description";
  }
  return transcriptMarkdown
    ? "summary + conversation transcript written to .get-an-expert/CONTEXT.md"
    : "summary only written to .get-an-expert/CONTEXT.md";
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * On startup, rejoin a request that was queued before the process restarted:
 * reconnect to the relay and re-arm the scopes the user already approved, so a
 * request survives an editor/agent restart without vanishing or needing
 * re-approval. Bounded by the resume record's age and GET_AN_EXPERT_AUTO_RESUME;
 * any failure clears the stale record and starts clean.
 */
async function attemptAutoResume(): Promise<void> {
  if (!autoResume()) return;
  const record = readResume();
  if (!record) return;
  if (Date.now() - record.createdAt >= sessionMaxAgeMs()) {
    clearResume();
    return;
  }
  const resumed = new AgentSession({
    relayUrl: record.relayUrl || relayUrl(),
    projectDir: record.projectDir,
    customerName: record.customerName,
    log: (line) => console.error(`[get-an-expert] ${line}`),
  });
  try {
    await resumed.resumeExpert(record);
    session = resumed;
    console.error(
      `[get-an-expert] resumed queued request ${record.sessionId} after restart`,
    );
  } catch (err) {
    // Session gone/expired, or the relay is unreachable: drop the stale record.
    clearResume();
    console.error(`[get-an-expert] could not auto-resume: ${errText(err)}`);
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[get-an-expert] agent ready (relay: ${relayUrl()})`);
  // Best-effort; never blocks the server from coming up.
  void attemptAutoResume();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    try {
      session?.cleanupContextSync();
    } catch {
      /* ignore */
    }
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
