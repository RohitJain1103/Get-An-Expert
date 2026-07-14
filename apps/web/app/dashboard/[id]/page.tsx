import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { getStore } from "@/lib/store";

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

  const { payload, response } = request;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <Link href="/dashboard" className="text-sm text-zinc-500 underline">
        ← All requests
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{payload.expertiseArea}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {request.id} · {payload.tool} ·{" "}
        {new Date(request.createdAt).toLocaleString()} · status:{" "}
        {request.status} · consent {request.consent.textVersion} at{" "}
        {request.consent.at}
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

      {response && (
        <div className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Expert response</h2>
          <Field label="Intro">{response.intro}</Field>
          <Field label="Diagnosis">{response.diagnosis}</Field>
          <Field label="Suggested prompt">
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">
              {response.suggestedPrompt}
            </pre>
          </Field>
        </div>
      )}
    </main>
  );
}
