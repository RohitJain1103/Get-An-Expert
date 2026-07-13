"use client";

import { use, useState } from "react";

type Status = "idle" | "working" | "deleted" | "error";

export default function DeleteRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = use(params);
  const { token } = use(searchParams);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete() {
    setStatus("working");
    try {
      const res = await fetch(
        `/api/v1/requests/${encodeURIComponent(id)}?token=${encodeURIComponent(token ?? "")}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (res.ok && body.success) {
        setStatus("deleted");
      } else {
        setErrorMessage(body.error ?? "Deletion failed.");
        setStatus("error");
      }
    } catch {
      setErrorMessage("Network error — please try again.");
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Delete your data</h1>
      {status === "deleted" ? (
        <p className="text-green-700 dark:text-green-400">
          Done — request <code className="font-mono">{id}</code> and everything
          attached to it has been permanently deleted from our servers.
        </p>
      ) : (
        <>
          <p className="text-neutral-600 dark:text-neutral-400">
            This permanently deletes request{" "}
            <code className="font-mono">{id}</code> — the session summary you
            sent us and the suggestion we generated. It can&apos;t be undone.
            (If you do nothing, it auto-deletes 30 days after it was created.)
          </p>
          {!token && (
            <p className="text-red-600 dark:text-red-400">
              This link is missing its deletion token. Use the full link from
              your expert response.
            </p>
          )}
          {status === "error" && (
            <p className="text-red-600 dark:text-red-400">{errorMessage}</p>
          )}
          <button
            onClick={handleDelete}
            disabled={!token || status === "working"}
            className="w-fit rounded-lg bg-red-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "working" ? "Deleting…" : "Permanently delete"}
          </button>
        </>
      )}
    </main>
  );
}
