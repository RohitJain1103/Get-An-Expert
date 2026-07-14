import { z } from "zod";

/**
 * Version of the consent text shown to users in the MCP flow. Bump whenever
 * the consent wording changes; stored with every request as proof of what the
 * user agreed to.
 */
export const CONSENT_TEXT_VERSION = "2026-07-13.v3";

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

/**
 * Optional consented progress update attached to a user thread message:
 * what was tried since the expert's last reply, and any new errors. Same
 * data-minimization stance as the original payload — never a transcript.
 */
export const threadProgressSchema = z.object({
  whatWasTried: z.array(z.string().min(1).max(2000)).max(10).default([]),
  errorMessages: z.array(z.string().min(1).max(6000)).max(10).default([]),
});

export type ThreadProgressInput = z.infer<typeof threadProgressSchema>;

/** Body of POST /api/v1/requests/[id]/messages. */
export const threadMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  progress: threadProgressSchema.optional(),
});

export type ThreadMessageInput = z.infer<typeof threadMessageSchema>;
