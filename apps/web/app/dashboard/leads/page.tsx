import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { leadStats, leadsConfigured, listLeads } from "@/lib/leads-db";
import { loginToDashboard } from "../actions";

export const dynamic = "force-dynamic";

const BRAND = "#2F4A38";

function PasscodeGate() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Get An Expert: Leads</h1>
      <form action={loginToDashboard} className="flex flex-col gap-3">
        <input
          type="password"
          name="passcode"
          placeholder="Passcode"
          autoFocus
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="rounded-lg px-4 py-2 font-medium text-white"
          style={{ backgroundColor: BRAND }}
        >
          Enter
        </button>
      </form>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ended: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function relative(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await isDashboardAuthed())) return <PasscodeGate />;

  if (!leadsConfigured()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          No leads database is connected yet. Set{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">LEADS_DATABASE_URL</code>{" "}
          on this deployment to the same Postgres the relay writes to, then reload.
        </p>
      </main>
    );
  }

  const q = (await searchParams).q ?? "";
  const [leads, stats] = await Promise.all([listLeads(200, q), leadStats()]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-zinc-500">Kept permanently. Survives redeploys.</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total" value={stats.total} hint="all time" />
        <Stat label="Last 7 days" value={stats.last7Days} />
        <Stat label="Last 30 days" value={stats.last30Days} />
        <Stat label="Claimed" value={stats.claimed} hint="an expert joined" />
        <Stat label="Delivered" value={stats.delivered} hint="work handed back" />
        <Stat label="Waiting now" value={stats.waiting} hint="needs an expert" />
        <Stat label="Never reached" value={stats.missed} hint="ended unclaimed" />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <form className="flex-1">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name or request…"
            className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>
        <a
          href="/dashboard/leads/export"
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: BRAND }}
        >
          Download CSV
        </a>
      </div>

      {leads.length === 0 ? (
        <p className="mt-10 text-zinc-500">
          {q ? `No leads match "${q}".` : "No leads recorded yet."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">What they asked for</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Expert</th>
                <th className="py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {leads.map((lead) => (
                <tr key={lead.sessionId} className="align-top">
                  <td
                    className="whitespace-nowrap py-3 pr-4 text-zinc-500"
                    title={lead.createdAt.toLocaleString()}
                  >
                    {relative(lead.createdAt)}
                  </td>
                  <td className="py-3 pr-4 font-medium">{lead.customerName}</td>
                  <td className="max-w-md py-3 pr-4 text-zinc-600 dark:text-zinc-400">
                    {lead.issue ?? <span className="italic text-zinc-400">no description</span>}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[lead.status] ?? ""
                      }`}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4">
                    {lead.expertName ?? <span className="text-zinc-400">unclaimed</span>}
                  </td>
                  <td className="max-w-xs py-3 text-zinc-600 dark:text-zinc-400">
                    {lead.deliverySummary ?? (
                      <span className="text-zinc-400">nothing delivered</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
