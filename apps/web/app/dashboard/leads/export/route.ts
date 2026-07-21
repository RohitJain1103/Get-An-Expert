import { toCsv } from "@/lib/csv";
import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { listLeads } from "@/lib/leads-db";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "requested_at",
  "customer",
  "request",
  "project_dir",
  "status",
  "expert",
  "claimed_at",
  "ended_at",
  "delivered",
  "accepted",
  "session_id",
] as const;

export async function GET(): Promise<Response> {
  if (!(await isDashboardAuthed())) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Generous cap: this is an export, not a page of results.
  const leads = await listLeads(10_000);
  const csv = toCsv(
    COLUMNS,
    leads.map((lead) => [
      lead.createdAt,
      lead.customerName,
      lead.issue,
      lead.projectDir,
      lead.status,
      lead.expertName,
      lead.claimedAt,
      lead.endedAt,
      lead.deliverySummary,
      lead.deliveryAccepted,
      lead.sessionId,
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="get-an-expert-leads-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
