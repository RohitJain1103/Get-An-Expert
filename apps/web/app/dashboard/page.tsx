import Link from "next/link";
import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { getStore } from "@/lib/store";
import { listExpertRequests } from "@/lib/usecases";
import { loginToDashboard } from "./actions";

export const dynamic = "force-dynamic";

function PasscodeGate() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Get An Expert — Dashboard</h1>
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
          className="rounded-lg bg-black px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-black"
        >
          Enter
        </button>
      </form>
    </main>
  );
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  live: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  solved: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default async function DashboardPage() {
  if (!(await isDashboardAuthed())) {
    return <PasscodeGate />;
  }

  const requests = await listExpertRequests(getStore(), 100);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Expert requests</h1>
        <p className="text-sm text-zinc-500">{requests.length} shown</p>
      </div>

      {requests.length === 0 ? (
        <p className="mt-10 text-zinc-500">
          No requests yet. They&apos;ll show up here the moment someone asks
          for help.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/dashboard/${request.id}`}
                className="flex flex-col gap-1 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[request.status] ?? ""}`}
                  >
                    {request.status}
                  </span>
                  <span className="font-medium">
                    {request.payload.expertiseArea}
                  </span>
                  <span className="text-sm text-zinc-500">
                    via {request.payload.tool}
                  </span>
                  <span className="ml-auto text-sm text-zinc-500">
                    {new Date(
                      request.lastActivityAt ?? request.createdAt,
                    ).toLocaleString()}
                  </span>
                </div>
                <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                  {request.payload.goal}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
