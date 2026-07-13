import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ThreadMessage } from "@get-an-expert/core";
import { isDashboardAuthed } from "@/lib/dashboard-auth";
import { getStore } from "@/lib/store";
import {
  claimThreadAction,
  replyToThreadAction,
  solveThreadAction,
} from "../actions";

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
  solved:
    "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function ThreadEntry({ message }: { message: ThreadMessage }) {
  const time = new Date(message.at).toLocaleString();
  if (message.kind === "activity") {
    return (
      <li className="border-l-2 border-zinc-200 pl-3 font-mono text-xs text-zinc-500 dark:border-zinc-800">
        <span className="whitespace-pre-wrap">{message.text}</span> · {time}
      </li>
    );
  }
  const isExpert = message.from === "expert";
  return (
    <li
      className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${
        isExpert
          ? "ml-auto border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <p className="mb-1 text-xs font-medium text-zinc-500">
        {isExpert ? "You (expert)" : "User"} · {time}
      </p>
      <p className="whitespace-pre-wrap">{message.text}</p>
    </li>
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
  const store = getStore();
  const request = await store.get(id);
  if (!request) notFound();

  const messages = await store.listMessages(id, 0);
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
        {request.id} · {payload.tool} ·{" "}
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

      <section className="mt-10 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Thread</h2>
          {request.status !== "solved" && (
            <form action={solveThreadAction}>
              <input type="hidden" name="id" value={request.id} />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Mark solved
              </button>
            </form>
          )}
        </div>

        {messages.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No messages yet — claim the thread and send the first reply.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {messages.map((message) => (
              <ThreadEntry key={message.seq} message={message} />
            ))}
          </ul>
        )}

        {!request.expertName && (
          <form action={claimThreadAction} className="mt-6 flex gap-2">
            <input type="hidden" name="id" value={request.id} />
            <input
              type="text"
              name="expertName"
              required
              placeholder="Your display name (shown to the user)"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
            >
              Claim thread
            </button>
          </form>
        )}

        <form action={replyToThreadAction} className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="id" value={request.id} />
          <textarea
            name="text"
            required
            rows={4}
            maxLength={4000}
            placeholder="Reply to the user — they'll see it in their coding session"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="self-end rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
          >
            Send reply
          </button>
        </form>
      </section>
    </main>
  );
}
