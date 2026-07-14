import type { NextRequest } from "next/server";
import { listChatMessages, postChatMessage } from "@/lib/chat";
import { authenticateChatActor } from "@/lib/chat-auth";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import {
  checkChatPollRateLimit,
  checkChatPostRateLimit,
} from "@/lib/ratelimit";
import { chatMessageBodySchema } from "@/lib/schema";
import { getStore } from "@/lib/store";

/** Reject oversized bodies before buffering/parsing (defense in depth). */
const MAX_BODY_BYTES = 10_000;

const fail = (status: number, error: string) =>
  Response.json({ success: false, data: null, error }, { status });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const store = getStore();
  // IP gate before any token work — cheap rejection of floods.
  const rate = await checkChatPollRateLimit(store, clientIp(request.headers));
  if (!rate.allowed) return fail(429, "Polling too fast — slow down.");

  const { id } = await params;
  const record = await store.get(id);
  if (!record) return fail(404, "Request not found or expired.");

  const actor = await authenticateChatActor(request, record);
  if (!actor) return fail(401, "Missing or invalid chat credentials.");

  const afterRaw = request.nextUrl.searchParams.get("after") ?? "0";
  const after = Number(afterRaw);
  if (!Number.isInteger(after) || after < 0) {
    return fail(400, "'after' must be a non-negative integer.");
  }

  const { messages, chat } = await listChatMessages(store, id, after);
  return Response.json({
    success: true,
    data: {
      messages,
      chat: chat
        ? { status: chat.status, expertName: chat.expertName ?? null }
        : null,
    },
    error: null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, "Message too large.");
  }

  const store = getStore();
  const rate = await checkChatPostRateLimit(store, clientIp(request.headers));
  if (!rate.allowed) return fail(429, "Sending too fast — slow down.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body must be valid JSON.");
  }
  const parsed = chatMessageBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "Invalid message: text must be 1-4000 characters.");
  }

  const { id } = await params;
  const record = await store.get(id);
  if (!record) return fail(404, "Request not found or expired.");

  const actor = await authenticateChatActor(request, record);
  if (!actor) return fail(401, "Missing or invalid chat credentials.");

  const result = await postChatMessage({
    store,
    record,
    from: actor.role,
    authorName: actor.role === "expert" ? env.expertDisplayName() : undefined,
    text: parsed.data.text,
  });
  if (result.outcome === "ended") {
    // 410 is the contract for the hard stop: the session is gone for good.
    return fail(410, "This chat has ended. Nothing is shared anymore.");
  }
  return Response.json({
    success: true,
    data: { seq: result.seq },
    error: null,
  });
}
