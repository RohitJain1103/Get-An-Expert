#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearResume, readResume } from "@get-an-expert/core/relay";
import { AgentSession } from "./agent-session";
import {
  SCOPES_CONFIRM_GUIDANCE,
  buildDeclinedMessage,
  buildElicitationFailedMessage,
  buildScopesMessage,
  canFinalizePending,
  resolveScopeElicitation,
  type ConsentMechanism,
  type ScopeConsent,
} from "./consent";
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
import { openUrl } from "./open-url";
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
const INSTRUCTIONS = `Get An Expert brings a real human expert onto the user's machine, through scoped, consent-based access — for anything from fixing a bug to reviewing, polishing, or extending what's already there. The expert works in the user's own project directory — reading files, running commands, checking the browser — and the user sees a live log of every action and can revoke any scope at any time.

When the user asks for a human expert (or runs /get-an-expert), call request_expert_help immediately using whatever context already exists in this conversation. Do not ask clarifying questions first, do not offer automated alternatives instead, and do not gate on the ask being a specific reproducible bug — an open-ended "could this be better?" is a legitimate ask; the expert can ask their own follow-up questions once connected. That tool asks the user to approve three scopes — Files, Terminal, and Browser — either through an inline prompt or, on hosts without one, a plain-language description you must relay verbatim and then confirm with confirm_expert_scopes; relay whichever response request_expert_help returns verbatim. After an expert is requested, use expert_status to tell the user whether an expert has joined and what they have done so far (the live activity log). If the user wants to withdraw a scope, call revoke_access; when they're done, call end_session and relay the summary. Never grant or revoke on the user's behalf without them asking.

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
      "Registers a help session and asks the user to approve the scopes an expert may use on their machine (Files, Terminal, Browser) — inline where the host supports it, otherwise via a plain-language description that confirm_expert_scopes finalizes. Nothing is granted until the user approves. Call this immediately when the user asks for a human expert; do not gate on the ask being a specific bug.",
    inputSchema: {
      issue: z
        .string()
        .max(2000)
        .optional()
        .describe(
          "Short description of what the user wants help with, from this conversation — a bug, or an open-ended ask like a review or improvement.",
        ),
      summary: z
        .string()
        .max(4000)
        .describe(
          "Hand-off notes for the human expert, written from this conversation: what the user is trying to do; the exact error or wrong behavior, quoted, if there is one; if the ask is open-ended (e.g. 'could this be improved'), say so plainly rather than inventing a bug; what's been tried, if anything, and why; which files/commands are involved; and how to run the app and its tests (plus any test login details the expert will need). Be specific — this is the first thing the expert reads.",
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
    try {
      await session.requestExpert(issue);
    } catch (err) {
      session = undefined;
      return text(
        `Could not reach the Get An Expert relay at ${relayUrl()}. Is it running? (${errText(err)})`,
      );
    }

    // Ask the user to approve the scopes: inline via elicitation where the
    // host supports it, otherwise fall back to a plain-language confirmation
    // finalized by confirm_expert_scopes.
    const outcome = await resolveScopeElicitation({
      dir,
      port,
      capabilities: server.server.getClientCapabilities(),
      elicit: (params) => server.server.elicitInput(params),
    });
    switch (outcome.kind) {
      case "unsupported":
        // Not a decision by anyone — the host just can't show a prompt.
        // Keep the session queued; confirm_expert_scopes finishes it later.
        // Bind it to this session id so a stale confirmation can't be replayed.
        pendingConfirmation = { dir, port, issue, summary, sessionId: session.sessionId };
        return {
          content: [
            { type: "text" as const, text: buildScopesMessage(dir, port) },
            { type: "text" as const, text: SCOPES_CONFIRM_GUIDANCE },
          ],
        };
      case "failed":
        await session.end("elicitation failed");
        session = undefined;
        return text(buildElicitationFailedMessage());
      case "declined":
        await session.end("consent declined");
        session = undefined;
        return text(buildDeclinedMessage());
      case "granted":
        return finalizeGrant(session, outcome.consent, {
          issue,
          summary,
          projectDir: dir,
          mechanism: "elicitation",
        });
    }
  },
);

/* ── confirm_expert_scopes ────────────────────────────────────────── */

/** A request_expert_help call awaiting plain-language scope confirmation,
 * on hosts that don't support inline elicitation. */
interface PendingConfirmation {
  dir: string;
  port: number;
  issue: string | undefined;
  summary: string;
  /** The session this confirmation belongs to — a confirmation can only
   * finalize the same session that created it (see canFinalizePending). */
  sessionId: string | undefined;
}
let pendingConfirmation: PendingConfirmation | undefined;

server.registerTool(
  "confirm_expert_scopes",
  {
    title: "Confirm expert access scopes",
    description:
      "Finalizes scopes for a pending request after relaying the plain-language scope description from request_expert_help and getting the user's reply. Only call after request_expert_help returned that description (i.e. this host has no inline approval prompt). Set each field true only if the user explicitly approved it; default anything unaddressed to false.",
    inputSchema: {
      files: z.boolean().describe("User approved file read/edit access."),
      terminal: z.boolean().describe("User approved running terminal commands."),
      browser: z.boolean().describe("User approved viewing the browser/dev server."),
      conversation: z
        .boolean()
        .describe("User approved sharing this conversation as expert context."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ files, terminal, browser, conversation }) => {
    // Fails closed unless there's a pending confirmation bound to THIS active
    // session — so a confirmation left over from an ended/replaced session
    // can't grant access in a new one.
    if (!pendingConfirmation || !session || !canFinalizePending(pendingConfirmation, session)) {
      return text("No pending scope confirmation. Call request_expert_help first.");
    }
    const { dir, port, issue, summary } = pendingConfirmation;
    pendingConfirmation = undefined;
    if (!files && !terminal && !browser) {
      await session.end("consent declined");
      session = undefined;
      return text(buildDeclinedMessage());
    }
    const grant: Grant = { files, terminal, browser };
    if (browser) grant.browserPort = port;
    return finalizeGrant(
      session,
      { grant, shareTranscript: conversation },
      { issue, summary, projectDir: dir, mechanism: "chat-fallback" },
    );
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
      message: statusMessage(session.state, session.expertName, session.expertProfile),
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
    pendingConfirmation = undefined;
    return jsonWithGuidance({ status: "ended", message: END_SESSION_MESSAGE, summary });
  },
);

/**
 * Grant the approved scopes, write the expert's hand-off context, and build
 * the "queued" response. Shared by both consent paths (inline elicitation
 * and the plain-language confirm_expert_scopes fallback) so their output is
 * identical regardless of how consent was obtained.
 */
async function finalizeGrant(
  activeSession: AgentSession,
  consent: ScopeConsent,
  input: {
    issue: string | undefined;
    summary: string;
    projectDir: string;
    mechanism: ConsentMechanism;
  },
) {
  activeSession.grant(consent.grant);
  // Audit which consent path granted access, so a host-verified approval is
  // distinguishable from a model-mediated chat reply after the fact.
  activeSession.recordConsent(
    input.mechanism === "elicitation" ? "host approval prompt" : "your reply in chat",
  );

  // Hand-off context for the expert — local + peer-to-peer only, and never
  // allowed to block the request: any failure degrades the file instead.
  const context = await writeSessionContext(activeSession, {
    issue: input.issue,
    summary: input.summary,
    projectDir: input.projectDir,
    shareTranscript: consent.shareTranscript,
  });

  const chatUrl = activeSession.chatUrl;
  // Best-effort auto-open of the chat page. A throw here must never fail the
  // request: openUrl already never throws, but the guard keeps that promise
  // even if that ever changes. The chat URL is always in the message below,
  // whether or not a tab opened, so failure costs one click, never access.
  let opened = false;
  if (chatUrl) {
    try {
      opened = openUrl(chatUrl, { relayOrigin: relayHttpOrigin() });
    } catch {
      opened = false;
    }
  }
  return json({
    status: "waiting-for-expert",
    sessionId: activeSession.sessionId,
    chatUrl,
    projectDir: input.projectDir,
    granted: consent.grant,
    consentVia: input.mechanism,
    context,
    message: queueMessage(chatUrl, opened),
  });
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
    await activeSession.writeContextFrom({
      customerName: customerName(),
      issue: input.issue,
      summary: input.summary,
      overview,
      transcriptMarkdown,
      requestedAt: Date.now(),
    });
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
 * The relay's http(s) origin, derived from the configured relay URL the same
 * way chat-url.ts builds the chat page URL: normalize ws(s) to http(s), then
 * take the origin. openUrl only opens URLs whose origin equals this, so the
 * auto-open can never be steered to some other host.
 */
function relayHttpOrigin(): string {
  return new URL(relayUrl().trim().replace(/^ws/, "http")).origin;
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
