import { z } from "zod";

/**
 * Version of the consent text shown to users in the MCP flow. Bump whenever
 * the consent wording changes; stored with every request as proof of what the
 * user agreed to. 2026-07-14.v2 = experts-only + live chat + session relay.
 */
export const CONSENT_TEXT_VERSION = "2026-07-14.v2";

/** Hard size limits: fail fast, keep payloads minimal (data minimization). */
export const expertRequestSchema = z.object({
  tool: z.string().min(1).max(60),
  goal: z.string().min(1).max(2000),
  whatWasTried: z.array(z.string().min(1).max(4000)).max(20).default([]),
  errorMessages: z.array(z.string().min(1).max(6000)).max(20).default([]),
  conversationSummary: z.string().max(20000).default(""),
  techStack: z.array(z.string().min(1).max(100)).max(20).default([]),
  expertiseArea: z.string().min(1).max(100),
  messagesStuckCount: z.number().int().min(0).max(10000).optional(),
  installId: z.string().min(1).max(80).optional(),
  clientRedactions: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        count: z.number().int().min(0),
      }),
    )
    .max(50)
    .optional(),
  /** Requests without explicit consent are rejected at the schema level. */
  consent: z.object({
    agreed: z.literal(true),
    textVersion: z.string().min(1).max(40),
    at: z.string().min(1).max(40),
  }),
});

export type ExpertRequestInput = z.infer<typeof expertRequestSchema>;

/** One chat line. Generous for pasted snippets, hard-capped for abuse. */
export const chatMessageBodySchema = z.object({
  text: z.string().min(1).max(4000),
});

/**
 * One relayed session event. Clients fold command output into the command
 * event's text and truncate locally; the cap here is the abuse backstop.
 */
export const relayEventBodySchema = z.object({
  type: z.enum(["prompt", "command", "output", "edit", "agent_reply"]),
  text: z.string().min(1).max(32000),
});
