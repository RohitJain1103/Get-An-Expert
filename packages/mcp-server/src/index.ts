#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ChatMessage } from "@get-an-expert/core";
import {
  readLastChat,
  readSessionStatus,
  writeLastChat,
  type SessionStatusRecord,
} from "@get-an-expert/core/relay";
import { submitExpertRequest, type ExpertHelpInput } from "./api";
import { privacyUrl, SERVER_NAME, SERVER_VERSION, apiBaseUrl } from "./config";
import {
  armRelay,
  buildChatFooter,
  buildJoinCommand,
  openTerminalA,
  spawnRelayInstall,
} from "./escalate";
import {
  buildConsentRequiredMessage,
  buildDeclinedMessage,
  buildElicitationFailedMessage,
  buildOfferMessage,
} from "./consent";

/**
 * Server instructions: injected into model context by Claude Code and Codex.
 * They describe the server's intended use. Honest and user-serving by design —
 * agent-directed manipulation here (or in tool descriptions) is what gets MCP
 * servers flagged and delisted. Keep under 2KB (Claude Code truncation cap).
 */
const INSTRUCTIONS = `Get An Expert brings a real human expert into a stuck coding session: with the user's explicit one-time consent it sends a structured summary of where the session is stuck and opens a live human-to-human chat terminal where an expert joins the user; while that chat is open the session relays live to the expert so they can watch real attempts instead of retellings.

When the user has been stuck on the same goal for many messages (roughly 10 or more — repeated failed attempts, the same error recurring, visible frustration), or when they ask for outside or human help, call offer_expert_help with a specific expertise area and relay its message to the user exactly as returned. That tool sends nothing; it only shows the user the offer and consent notice.

Only after the user clearly agrees, call request_expert_help. Fill its fields only from information already visible in this conversation — do not read files or any other source to populate them, and keep the summary brief. Relay the returned guidance (including the chat join instructions) to the user. If the user declines, respect that: don't offer again unless they get stuck on a different problem or ask for it.

While a session is live, expert_status reports whether an expert has joined and the recent actions they've taken on the machine — call it whenever the user asks what the expert is doing or has done. After a chat has happened, check_expert_replies returns anything new the human expert said, so the user can ask you to apply what the expert suggested.`;

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { instructions: INSTRUCTIONS },
);

/**
 * Set once offer_expert_help has run in this session. request_expert_help
 * refuses to send unless an offer (and its consent notice) was shown first,
 * so a request can't be fired "cold" without the user ever seeing the offer.
 */
let offerShownThisSession = false;

/** Normalize the MCP client name into our payload's tool label. */
function detectHostTool(): string {
  const raw = server.server.getClientVersion()?.name?.toLowerCase() ?? "";
  if (raw.includes("claude")) return "claude-code";
  if (raw.includes("codex")) return "codex";
  if (raw.includes("cursor")) return "cursor";
  if (raw.includes("windsurf")) return "windsurf";
  if (raw.includes("visual studio") || raw.includes("vscode")) return "vscode";
  return raw ? raw.slice(0, 60) : "unknown";
}

/** Human relative time ("3m ago") for the expert_status summary. */
function relativeTime(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Turn the agent's live status file into a plain-language answer to
 *  "what has the expert been doing?". */
function formatExpertStatus(status: SessionStatusRecord | null): string {
  if (!status || status.state === "idle" || status.state === "ended") {
    return "No live Get An Expert session is running on this machine right now. Call request_expert_help to start one.";
  }
  if (status.state === "waiting") {
    return "You're in the queue — no expert has joined yet. You can leave this open and check back; expert_status updates once someone joins.";
  }
  const who = status.expertName ?? "An expert";
  const header = `${who} is connected and working on your machine.`;
  const acts = Array.isArray(status.recentActivity) ? status.recentActivity : [];
  if (acts.length === 0) {
    return `${header} No actions logged yet.`;
  }
  const now = Date.now();
  const freshness = status.updatedAt
    ? ` Last update ${relativeTime(status.updatedAt, now)}.`
    : "";
  const lines = acts
    .slice(-12)
    .map((a) => `- ${a.summary}${a.at ? ` (${relativeTime(a.at, now)})` : ""}`)
    .join("\n");
  return `${header}${freshness}\n\nRecent actions (most recent last):\n${lines}`;
}

server.registerTool(
  "offer_expert_help",
  {
    title: "Offer expert help",
    description:
      "Returns Get An Expert's offer and consent notice for the user: what the " +
      "service does, exactly what data would be sent if they agree, what is never " +
      "sent, and retention/deletion terms. Sends no data anywhere.",
    inputSchema: {
      expertiseArea: z
        .string()
        .min(1)
        .max(100)
        .describe(
          'Specific domain of expertise needed, e.g. "React state management" or "Postgres query tuning"',
        ),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ expertiseArea }) => {
    offerShownThisSession = true;
    return {
      content: [{ type: "text", text: buildOfferMessage(expertiseArea) }],
    };
  },
);

server.registerTool(
  "request_expert_help",
  {
    title: "Request expert help",
    description:
      "Sends one structured summary of the current stuck session (goal, attempts, " +
      "error messages, short summary, tech stack) to the Get An Expert API for " +
      "review by a human expert, opens the live expert chat, and returns the " +
      "confirmation with join instructions. Requires the user's explicit prior " +
      "agreement; runs local secret redaction before anything is transmitted.",
    inputSchema: {
      goal: z
        .string()
        .min(1)
        .max(2000)
        .describe("What the user is ultimately trying to achieve"),
      whatWasTried: z
        .array(z.string().min(1).max(4000))
        .max(20)
        .default([])
        .describe("Approaches already attempted, in order"),
      errorMessages: z
        .array(z.string().min(1).max(6000))
        .max(20)
        .default([])
        .describe("Error messages encountered, verbatim where possible"),
      conversationSummary: z
        .string()
        .max(20000)
        .default("")
        .describe(
          "Brief summary of the stuck session, built only from this conversation",
        ),
      techStack: z
        .array(z.string().min(1).max(100))
        .max(20)
        .default([])
        .describe("Languages, frameworks, and services involved"),
      expertiseArea: z
        .string()
        .min(1)
        .max(100)
        .describe("Specific domain of expertise needed"),
      messagesStuckCount: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Roughly how many messages the user has been stuck for"),
      userConfirmed: z
        .boolean()
        .describe(
          "True only if the user explicitly agreed to send this request after seeing the consent notice",
        ),
    },
    annotations: {
      // Deliberately NOT readOnly: hosts should show their confirmation prompt —
      // that prompt is part of the consent story.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    const consentedAt = new Date();

    if (!args.userConfirmed) {
      return {
        isError: true,
        content: [{ type: "text", text: buildConsentRequiredMessage() }],
      };
    }

    // Refuse to send if the offer/consent notice was never shown this session.
    if (!offerShownThisSession) {
      return {
        isError: true,
        content: [{ type: "text", text: buildConsentRequiredMessage() }],
      };
    }

    // Where the host supports elicitation, confirm with the user directly —
    // consent shouldn't rest solely on a model-set flag.
    const capabilities = server.server.getClientCapabilities();
    if (capabilities?.elicitation) {
      try {
        const result = await server.server.elicitInput({
          message:
            `Send this to Get An Expert? One summary of the stuck session ` +
            `(goal, attempts, errors, tech stack — secrets redacted locally) ` +
            `is sent to ${apiBaseUrl()}, and a live human-expert chat opens; ` +
            `while it's open this session relays to the expert (end or pause ` +
            `anytime). Auto-deletes in 30 days.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                title: "Yes, send it",
              },
            },
            required: ["confirm"],
          },
        });
        if (result.action !== "accept" || result.content?.confirm !== true) {
          return {
            content: [{ type: "text", text: buildDeclinedMessage() }],
          };
        }
      } catch {
        // Fail closed: the host advertised elicitation but the confirmation
        // could not be completed, so we must NOT fall back to the model-set
        // userConfirmed flag and send silently. Block and ask to retry.
        return {
          isError: true,
          content: [{ type: "text", text: buildElicitationFailedMessage() }],
        };
      }
    }

    const input: ExpertHelpInput = {
      tool: detectHostTool(),
      goal: args.goal,
      whatWasTried: args.whatWasTried,
      errorMessages: args.errorMessages,
      conversationSummary: args.conversationSummary,
      techStack: args.techStack,
      expertiseArea: args.expertiseArea,
      messagesStuckCount: args.messagesStuckCount,
    };

    const result = await submitExpertRequest(input, consentedAt);
    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: result.error }],
      };
    }

    // Escalation extras (relay + Terminal A) are best-effort: a failure here
    // must never eat the submit result the user already paid for.
    let message = result.message;
    if (result.requestId && result.chatToken) {
      try {
        // Built locally from a validated id — the server's chatJoinCommand
        // string is deliberately never executed (it feeds terminal launchers).
        const joinCommand = buildJoinCommand(result.requestId);
        if (joinCommand) {
          armRelay(result.requestId, result.chatToken, apiBaseUrl());
          spawnRelayInstall(detectHostTool());
          const opened = openTerminalA(joinCommand);
          message = `${message}\n\n${buildChatFooter(joinCommand, opened)}`;
        }
      } catch (error) {
        console.error("[get-an-expert] escalation setup failed:", error);
      }
    }
    return {
      content: [{ type: "text", text: message }],
    };
  },
);

server.registerTool(
  "check_expert_replies",
  {
    title: "Check for expert replies",
    description:
      "Returns any new messages from the human expert in this machine's most " +
      "recent Get An Expert chat, plus the chat's status. Reads the local " +
      "chat record and fetches only this session's chat transcript; sends " +
      "nothing else.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const lastChat = readLastChat();
    if (!lastChat) {
      return {
        content: [
          {
            type: "text",
            text: "No expert chat on record for this machine yet.",
          },
        ],
      };
    }
    const baseUrl = (lastChat.apiBaseUrl ?? apiBaseUrl()).replace(/\/$/, "");
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/api/v1/requests/${lastChat.requestId}/messages?after=${lastChat.lastReadSeq}`,
        {
          headers: { "x-chat-token": lastChat.chatToken },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Could not reach Get An Expert to check for replies — try again shortly.",
          },
        ],
      };
    }
    let envelope: {
      success?: boolean;
      data?: {
        messages?: ChatMessage[];
        chat?: { status?: string; expertName?: string | null } | null;
      };
      error?: string;
    };
    try {
      envelope = (await response.json()) as typeof envelope;
    } catch {
      envelope = {};
    }
    if (!response.ok || !envelope.success || !envelope.data) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              envelope.error ??
              `Could not check replies (HTTP ${response.status}). The chat may have been deleted.`,
          },
        ],
      };
    }
    const messages = envelope.data.messages ?? [];
    const maxSeq = messages.reduce(
      (max, m) => Math.max(max, m.seq),
      lastChat.lastReadSeq,
    );
    if (maxSeq > lastChat.lastReadSeq) {
      try {
        writeLastChat({ ...lastChat, lastReadSeq: maxSeq });
      } catch {
        // best-effort cursor; worst case the same replies show twice
      }
    }
    const expertLines = messages
      .filter((m) => m.from === "expert" && m.kind === "message")
      .map((m) => `[${m.authorName ?? "expert"}] ${m.text}`);
    const status =
      envelope.data.chat?.status === "ended"
        ? "The chat has ended — nothing relays anymore."
        : "The chat is still open.";
    const text =
      expertLines.length > 0
        ? `New from the expert:\n\n${expertLines.join("\n")}\n\n${status}`
        : `No new expert messages. ${status}`;
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "expert_status",
  {
    title: "Check what the expert is doing",
    description:
      "Reports the live status of the on-machine expert session: whether an " +
      "expert has connected and the most recent actions they've taken on this " +
      "machine (files read/edited, commands run, pages checked). Reads a local " +
      "status file the agent keeps up to date; sends nothing.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const status = readSessionStatus();
    return { content: [{ type: "text", text: formatExpertStatus(status) }] };
  },
);

server.registerTool(
  "get_privacy_info",
  {
    title: "Privacy information",
    description:
      "Returns Get An Expert's data-handling summary: what is collected and when, " +
      "what is never collected, retention, and how deletion works. Sends no data.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async () => ({
    content: [
      {
        type: "text",
        text: [
          "**Get An Expert — data handling in plain words**",
          "",
          "- Nothing is ever sent anywhere until you explicitly say yes to a specific request.",
          "- If you agree, exactly one structured summary is sent: your goal, what was tried, error messages, a short session summary, and your tech stack — plus a random install ID used for rate limiting and deletion.",
          "- Saying yes also opens a live human-expert chat: the chat is human-to-human (no AI reads it), and while it is open your session's prompts, your agent's replies, agent-run commands with output, and file edits relay live to the expert. A RELAY ON indicator shows; /pause pauses relaying, /end (from either side) is a hard stop the server enforces.",
          "- Never sent: your source files, environment variables, or secrets. Secret redaction runs on your machine before transmission — chat messages and relayed events included — and again server-side, in both directions.",
          "- Your summary is reviewed by a human expert — no AI pipeline writes responses. No selling of data, no advertising use, no model training on your data.",
          "- Requests auto-delete after 30 days — chat and relayed events included; every response has a private deletion link that removes it all immediately.",
          "",
          `Full policy: ${privacyUrl()} · Terms: ${apiBaseUrl()}/terms`,
        ].join("\n"),
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries JSON-RPC; all logging goes to stderr.
  console.error(`[get-an-expert] MCP server v${SERVER_VERSION} ready (stdio)`);
}

main().catch((error) => {
  console.error("[get-an-expert] fatal:", error);
  process.exit(1);
});
