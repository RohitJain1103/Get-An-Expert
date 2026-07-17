import { z } from "zod";

/**
 * Relay wire protocol.
 *
 * The relay is a signaling server ONLY. It routes `signal` payloads opaquely
 * between the customer's agent and the claimed expert — it never parses,
 * logs, or stores them. Everything else it handles is session metadata:
 * who connected, when, which permissions were granted, and activity
 * summaries (action + target, never file contents / terminal output /
 * browser data).
 */

export const permissionsSchema = z.object({
  files: z.boolean(),
  terminal: z.boolean(),
  browser: z.boolean(),
  browserPort: z.number().int().min(1).max(65535).optional(),
});
export type Permissions = z.infer<typeof permissionsSchema>;

export const NO_PERMISSIONS: Permissions = {
  files: false,
  terminal: false,
  browser: false,
};

/* ── Chat messages (customer ↔ expert, relayed + stored in memory) ── */

/**
 * A single chat message as stored and fanned out by the relay. `text` has
 * already been through `redactText` by the time it is stored or forwarded.
 */
export const chatMessageSchema = z.object({
  at: z.number(),
  from: z.enum(["customer", "expert"]),
  name: z.string().min(1).max(120),
  text: z.string().max(2000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/* ── Messages the agent (customer machine) may send ─────────────── */

const agentRegister = z.object({
  type: z.literal("register"),
  customerName: z.string().min(1).max(120),
  projectDir: z.string().min(1).max(500),
  issue: z.string().max(2000).optional(),
});

/**
 * Rejoin an existing queued request after a reconnect or process restart. The
 * relay re-attaches this socket to the session if the token hash matches; the
 * request never left the queue (it was just marked offline).
 */
const agentResume = z.object({
  type: z.literal("resume"),
  sessionId: z.string().min(1).max(80),
  resumeToken: z.string().min(1).max(200),
});

const agentMetadata = z.object({
  type: z.literal("metadata"),
  permissions: permissionsSchema.optional(),
  activity: z
    .object({ kind: z.string().min(1).max(60), summary: z.string().max(500) })
    .optional(),
});

const agentSignal = z.object({
  type: z.literal("signal"),
  payload: z.unknown(),
});

const agentEnd = z.object({
  type: z.literal("end"),
  reason: z.string().max(200).optional(),
});

export const agentMessageSchema = z.discriminatedUnion("type", [
  agentRegister,
  agentResume,
  agentMetadata,
  agentSignal,
  agentEnd,
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/* ── Messages the expert (dashboard) may send ────────────────────── */

const expertAuth = z.object({
  type: z.literal("auth"),
  token: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
});

const expertClaim = z.object({
  type: z.literal("claim"),
  sessionId: z.string().min(1).max(80),
});

const expertRelease = z.object({
  type: z.literal("release"),
  sessionId: z.string().min(1).max(80),
});

const expertSignal = z.object({
  type: z.literal("signal"),
  sessionId: z.string().min(1).max(80),
  payload: z.unknown(),
});

const expertChat = z.object({
  type: z.literal("chat"),
  sessionId: z.string().min(1).max(80),
  text: z.string().min(1).max(2000),
});

const expertEnd = z.object({
  type: z.literal("end-session"),
  sessionId: z.string().min(1).max(80),
  reason: z.string().max(200).optional(),
});

export const expertMessageSchema = z.discriminatedUnion("type", [
  expertAuth,
  expertClaim,
  expertRelease,
  expertSignal,
  expertChat,
  expertEnd,
]);
export type ExpertMessage = z.infer<typeof expertMessageSchema>;

/* ── Messages the customer chat page may send ────────────────────── */

const customerHello = z.object({
  type: z.literal("hello"),
  sessionId: z.string().min(1).max(80),
  token: z.string().min(1).max(200),
});

const customerChat = z.object({
  type: z.literal("chat"),
  text: z.string().min(1).max(2000),
});

export const customerMessageSchema = z.discriminatedUnion("type", [
  customerHello,
  customerChat,
]);
export type CustomerMessage = z.infer<typeof customerMessageSchema>;

/** Parse a raw websocket frame into a validated message, or undefined. */
export function parseMessage<T>(
  raw: unknown,
  schema: z.ZodType<T>,
): T | undefined {
  if (typeof raw !== "string" && !Buffer.isBuffer(raw)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}
