import type { NextRequest } from "next/server";
import { analyzeStuckSession } from "@/lib/analyst";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/ratelimit";
import { expertRequestSchema } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { createExpertRequest } from "@/lib/usecases";

/** Analysis at high effort can take a couple of minutes. */
export const maxDuration = 300;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}

export async function POST(request: NextRequest) {
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
    clientIp(request),
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
      analyze: analyzeStuckSession,
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
