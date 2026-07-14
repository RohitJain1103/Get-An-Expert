#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { submitExpertRequest, type ExpertHelpInput } from "./api";
import { privacyUrl, SERVER_NAME, SERVER_VERSION, apiBaseUrl } from "./config";
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
const INSTRUCTIONS = `Get An Expert brings a real human expert into a stuck coding session: with the user's explicit consent it sends a structured summary of where the session is stuck to the Get An Expert API, where a human expert reviews it and responds with a diagnosis plus the exact next steps.

When the user has been stuck on the same goal for many messages (roughly 10 or more — repeated failed attempts, the same error recurring, visible frustration), or when they ask for outside or human help, call offer_expert_help with a specific expertise area and relay its message to the user exactly as returned. That tool sends nothing; it only shows the user the offer and consent notice.

Only after the user clearly agrees, call request_expert_help. Fill its fields only from information already visible in this conversation — do not read files or any other source to populate them, and keep the summary brief. Relay the returned confirmation to the user. If the user declines, respect that: don't offer again unless they get stuck on a different problem or ask for it.`;

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
      "review by a human expert, and returns the submission confirmation. Requires " +
      "the user's explicit prior agreement; runs local secret redaction before " +
      "anything is transmitted.",
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
            `is sent to ${apiBaseUrl()} for a human expert to review. ` +
            `Auto-deletes in 30 days.`,
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
    return {
      content: [{ type: "text", text: result.message }],
    };
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
          "- Never sent: your source files, the full conversation transcript, environment variables, or secrets. Secret redaction runs on your machine before transmission, and again server-side.",
          "- Your request is reviewed by a human expert who writes the response you receive. No selling of data, no advertising use, no model training on your data.",
          "- Requests auto-delete after 30 days; every response includes a private deletion link that removes it immediately.",
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
