import type { NextRequest } from "next/server";
import { endChatSession } from "@/lib/chat";
import { authenticateChatActor } from "@/lib/chat-auth";
import { clientIp } from "@/lib/client-ip";
import { checkChatPostRateLimit } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";

const fail = (status: number, error: string) =>
  Response.json({ success: false, data: null, error }, { status });

/** Either side ends the session; idempotent so retries are always safe. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const store = getStore();
  const rate = await checkChatPostRateLimit(store, clientIp(request.headers));
  if (!rate.allowed) return fail(429, "Too many requests — slow down.");

  const { id } = await params;
  const record = await store.get(id);
  if (!record) return fail(404, "Request not found or expired.");

  const actor = await authenticateChatActor(request, record);
  if (!actor) return fail(401, "Missing or invalid chat credentials.");

  await endChatSession({ store, record, by: actor.role });
  return Response.json({ success: true, data: { ended: true }, error: null });
}
