import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { getStore } from "@/lib/store";
import { ChatPanel } from "./chat-panel";

export const dynamic = "force-dynamic";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </h2>
      <div className="mt-1 text-sm leading-6">{children}</div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  live: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  solved: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isDashboardAuthed())) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const request = await getStore().get(id);
  if (!request) notFound();

  const { payload } = request;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <Link href="/dashboard" className="text-sm text-zinc-500 underline">
        ← All requests
      </Link>
      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{payload.expertiseArea}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[request.status] ?? ""}`}
        >
          {request.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {request.id} · {payload.tool} · from{" "}
        {payload.requesterName ?? "anonymous"} ·{" "}
        {new Date(request.createdAt).toLocaleString()} ·{" "}
        {request.expertName ? `expert: ${request.expertName}` : "unclaimed"} ·
        consent {request.consent.textVersion}
      </p>

      <Field label="Goal">{payload.goal}</Field>

      {payload.whatWasTried.length > 0 && (
        <Field label="What was tried">
          <ol className="list-decimal space-y-1 pl-5">
            {payload.whatWasTried.map((attempt, i) => (
              <li key={i}>{attempt}</li>
            ))}
          </ol>
        </Field>
      )}

      {payload.errorMessages.length > 0 && (
        <Field label="Errors">
          {payload.errorMessages.map((error, i) => (
            <pre
              key={i}
              className="mt-1 overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900"
            >
              {error}
            </pre>
          ))}
        </Field>
      )}

      {payload.conversationSummary && (
        <Field label="Session summary">
          <p className="whitespace-pre-wrap">{payload.conversationSummary}</p>
        </Field>
      )}

      <Field label="Tech stack">
        {payload.techStack.join(", ") || "—"}
        {payload.messagesStuckCount !== undefined &&
          ` · stuck for ${payload.messagesStuckCount} messages`}
      </Field>

      {(request.serverRedactions.length > 0 ||
        (payload.clientRedactions?.length ?? 0) > 0) && (
        <Field label="Redactions applied">
          client:{" "}
          {payload.clientRedactions
            ?.map((r) => `${r.type}×${r.count}`)
            .join(", ") || "none"}{" "}
          · server:{" "}
          {request.serverRedactions
            .map((r) => `${r.type}×${r.count}`)
            .join(", ") || "none"}
        </Field>
      )}

      <ChatPanel requestId={request.id} />
    </main>
  );
}
