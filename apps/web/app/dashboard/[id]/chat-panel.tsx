"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { redactText, type ChatMessage } from "@get-an-expert/core";

interface ChatData {
  messages: ChatMessage[];
  chat: { status: "active" | "ended"; expertName: string | null } | null;
}

const POLL_MS = 2500;

export function ChatPanel({ requestId }: { requestId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"active" | "ended" | "none">("none");
  const [draft, setDraft] = useState("");
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const polling = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    // Single-flight: overlapping polls (StrictMode double effects, slow
    // networks) would both read the same lastSeq and duplicate messages.
    if (polling.current) return;
    polling.current = true;
    try {
      const res = await fetch(
        `/api/v1/requests/${requestId}/messages?after=${lastSeq.current}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { data: ChatData };
      const fresh = body.data.messages;
      if (fresh.length > 0) {
        lastSeq.current = Math.max(
          lastSeq.current,
          fresh[fresh.length - 1].seq,
        );
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.seq));
          return [...prev, ...fresh.filter((m) => !known.has(m.seq))];
        });
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      }
      setStatus(body.data.chat?.status ?? "none");
      setError(null);
    } catch {
      setError("Connection lost — retrying…");
    } finally {
      polling.current = false;
    }
  }, [requestId]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  async function send() {
    const raw = draft.trim();
    if (!raw) return;
    // Local redaction before the network call — same defense-in-depth
    // contract as the CLI; the server redacts again.
    const text = redactText(raw).text;
    try {
      const res = await fetch(`/api/v1/requests/${requestId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setError(
          res.status === 410
            ? "This chat has ended."
            : "Message failed to send.",
        );
        return;
      }
      setDraft("");
      setError(null);
      await poll();
    } catch {
      // Keep the draft so nothing typed is lost.
      setError("Message failed to send — check your connection.");
    }
  }

  async function endSession() {
    if (!confirmingEnd) {
      setConfirmingEnd(true);
      return;
    }
    try {
      const res = await fetch(`/api/v1/requests/${requestId}/end`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Ending the session failed — try again.");
        return;
      }
      setError(null);
      await poll();
    } catch {
      setError("Ending the session failed — check your connection.");
    } finally {
      setConfirmingEnd(false);
    }
  }

  if (status === "none" && messages.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800">
        Live chat is not available for this request.
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Live chat{" "}
          <span
            className={status === "active" ? "text-green-600" : "text-zinc-500"}
          >
            · {status === "active" ? "active" : "ended"}
          </span>
        </h2>
        {status === "active" && (
          <button
            type="button"
            onClick={endSession}
            onBlur={() => setConfirmingEnd(false)}
            className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            {confirmingEnd ? "Click again to end for good" : "End Session"}
          </button>
        )}
      </div>

      <div
        ref={scroller}
        className="mt-4 max-h-96 space-y-2 overflow-y-auto text-sm"
      >
        {messages.length === 0 && (
          <p className="text-zinc-500">No messages yet.</p>
        )}
        {messages.map((m) =>
          m.kind === "system" ? (
            <p key={m.seq} className="text-center text-xs italic text-zinc-500">
              {m.text}
            </p>
          ) : (
            <p key={m.seq}>
              <span
                className={
                  m.from === "expert"
                    ? "font-semibold text-blue-600"
                    : "font-semibold"
                }
              >
                [{m.from === "expert" ? (m.authorName ?? "expert") : "user"}]
              </span>{" "}
              <span className="whitespace-pre-wrap">{m.text}</span>
            </p>
          ),
        )}
      </div>

      {status === "active" && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the user…"
            maxLength={4000}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Send
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
