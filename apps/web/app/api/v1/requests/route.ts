import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/ratelimit";
import { expertRequestSchema } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { createExpertRequest } from "@/lib/usecases";

/** Reject oversized bodies before buffering/parsing (defense in depth). */
const MAX_BODY_BYTES = 300_000;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { success: false, data: null, error: "Request body too large." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, data: null, error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = expertRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return Response.json(
      { success: false, data: null, error: `Invalid request: ${issues}` },
      { status: 400 },
    );
  }

  const store = getStore();
  const rate = await checkRateLimit(
    store,
    clientIp(request.headers),
    parsed.data.installId,
  );
  if (!rate.allowed) {
    return Response.json(
      {
        success: false,
        data: null,
        error:
          "You've hit the request limit for now — give it a little time and try again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds ?? 3600) },
      },
    );
  }

  try {
    const result = await createExpertRequest({
      store,
      input: parsed.data,
      baseUrl: env.publicBaseUrl(),
    });
    return Response.json({
      success: true,
      data: {
        requestId: result.requestId,
        status: result.status,
        message: result.message,
        deleteUrl: result.deleteUrl,
        deleteToken: result.deleteToken,
        chatToken: result.chatToken,
        chatJoinCommand: `npx get-an-expert chat ${result.requestId}`,
      },
      error: null,
    });
  } catch (error: unknown) {
    console.error("[get-an-expert] request creation failed", error);
    return Response.json(
      {
        success: false,
        data: null,
        error: "Something broke on our end. Please try again in a minute.",
      },
      { status: 500 },
    );
  }
}
