import type { NextRequest } from "next/server";
import { postRelayEvent, verifyChatToken } from "@/lib/chat";
import { clientIp } from "@/lib/client-ip";
import { checkEventRateLimit } from "@/lib/ratelimit";
import { relayEventBodySchema } from "@/lib/schema";
import { getStore } from "@/lib/store";

/** Event text is capped at 32k by schema; this bounds the raw body. */
const MAX_BODY_BYTES = 64_000;

const fail = (status: number, error: string) =>
  Response.json({ success: false, data: null, error }, { status });

/**
 * Relayed session events from the user's working machine. Chat-token only:
 * hooks always act for the user; the expert never posts events.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, "Event too large.");
  }

  const store = getStore();
  // IP gate before any token work — cheap rejection of floods.
  const rate = await checkEventRateLimit(store, clientIp(request.headers));
  if (!rate.allowed) return fail(429, "Relaying too fast — slow down.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body must be valid JSON.");
  }
  const parsed = relayEventBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "Invalid event: known type and 1-32000 char text required.");
  }

  const { id } = await params;
  const record = await store.get(id);
  if (!record) return fail(404, "Request not found or expired.");

  const token = request.headers.get("x-chat-token") ?? "";
  if (!verifyChatToken(record, token)) {
    return fail(401, "Missing or invalid chat token.");
  }

  const result = await postRelayEvent({
    store,
    record,
    type: parsed.data.type,
    text: parsed.data.text,
  });
  if (result.outcome === "unavailable") {
    return fail(409, "Live chat is not available for this request.");
  }
  if (result.outcome === "ended") {
    // The hard-stop contract: once ended, nothing relays — clients delete
    // their local relay flag when they see this status.
    return fail(410, "This chat has ended. Nothing is shared anymore.");
  }
  return Response.json({
    success: true,
    data: { seq: result.seq },
    error: null,
  });
}
