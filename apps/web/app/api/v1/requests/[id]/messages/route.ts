import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import {
  checkThreadQuota,
  checkThreadReadRateLimit,
  checkThreadWriteRateLimit,
} from "@/lib/ratelimit";
import { threadMessageSchema } from "@/lib/schema";
import { getStore } from "@/lib/store";
import {
  listThreadMessages,
  postUserMessage,
  verifyThreadToken,
} from "@/lib/usecases";

/** Reject oversized bodies before buffering/parsing (defense in depth). */
const MAX_BODY_BYTES = 100_000;

function bearerToken(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

function failure(reason: "not_found" | "forbidden"): Response {
  if (reason === "not_found") {
    return Response.json(
      {
        success: false,
        data: null,
        error: "Thread not found — it may have been deleted or expired.",
      },
      { status: 404 },
    );
  }
  return Response.json(
    { success: false, data: null, error: "Invalid thread token." },
    { status: 403 },
  );
}

/** New thread messages after ?after=<seq>, for the MCP client / plugin poll. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { success: false, data: null, error: "Missing thread token." },
      { status: 401 },
    );
  }

  const store = getStore();
  const rate = await checkThreadReadRateLimit(store, clientIp(request.headers));
  if (!rate.allowed) {
    return Response.json(
      { success: false, data: null, error: "Checking too often — try again in a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) },
      },
    );
  }

  const afterRaw = Number(request.nextUrl.searchParams.get("after") ?? "0");
  const afterSeq =
    Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;

  const result = await listThreadMessages({ store, id, token, afterSeq });
  if (!result.ok) return failure(result.reason);
  return Response.json({
    success: true,
    data: {
      status: result.status,
      expertName: result.expertName ?? null,
      messages: result.messages,
    },
    error: null,
  });
}

/** Posts a user message (and optional consented progress update). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { success: false, data: null, error: "Missing thread token." },
      { status: 401 },
    );
  }

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
  const parsed = threadMessageSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return Response.json(
      { success: false, data: null, error: `Invalid message: ${issues}` },
      { status: 400 },
    );
  }

  const store = getStore();
  // Order matters: IP limits gate unauthenticated traffic, then the token is
  // verified, and only THEN is the per-thread quota consumed — so someone who
  // merely knows a request id can never exhaust a real thread's budget.
  const ipRate = await checkThreadWriteRateLimit(store, clientIp(request.headers));
  if (!ipRate.allowed) {
    return Response.json(
      {
        success: false,
        data: null,
        error: "Message limit reached for now — give it a little time.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(ipRate.retryAfterSeconds ?? 3600) },
      },
    );
  }

  const record = await verifyThreadToken(store, id, token);
  if (typeof record === "string") return failure(record);

  const quota = await checkThreadQuota(store, id);
  if (!quota.allowed) {
    return Response.json(
      {
        success: false,
        data: null,
        error: "This thread hit its hourly message limit — give it a little time.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(quota.retryAfterSeconds ?? 3600) },
      },
    );
  }

  try {
    const result = await postUserMessage({
      store,
      id,
      token,
      text: parsed.data.text,
      progress: parsed.data.progress,
    });
    if (!result.ok) {
      if (result.reason === "thread_full") {
        return Response.json(
          {
            success: false,
            data: null,
            error:
              "This thread has reached its message limit. Open a fresh request to keep going.",
          },
          { status: 409 },
        );
      }
      return failure(result.reason);
    }
    return Response.json({
      success: true,
      data: { seq: result.seq, status: result.status },
      error: null,
    });
  } catch (error: unknown) {
    console.error("[get-an-expert] thread message failed for", id, error);
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
