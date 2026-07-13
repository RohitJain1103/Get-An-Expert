import type { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { deleteExpertRequest } from "@/lib/usecases";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token =
    request.headers.get("x-delete-token") ??
    request.nextUrl.searchParams.get("token") ??
    "";

  if (!token) {
    return Response.json(
      { success: false, data: null, error: "Missing deletion token." },
      { status: 400 },
    );
  }

  const outcome = await deleteExpertRequest(getStore(), id, token);
  if (outcome === "not_found") {
    return Response.json(
      {
        success: false,
        data: null,
        error: "Request not found — it may already be deleted or expired.",
      },
      { status: 404 },
    );
  }
  if (outcome === "forbidden") {
    return Response.json(
      { success: false, data: null, error: "Invalid deletion token." },
      { status: 403 },
    );
  }
  return Response.json({
    success: true,
    data: { deleted: true },
    error: null,
  });
}
