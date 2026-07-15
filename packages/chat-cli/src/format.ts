import type { ChatMessage } from "@get-an-expert/core";

export type ParsedInput =
  | { type: "message"; text: string }
  | { type: "empty" }
  | { type: "end" }
  | { type: "pause"; minutes: number }
  | { type: "pause-off" }
  | { type: "unknown-command"; command: string };

const DEFAULT_PAUSE_MINUTES = 15;

/** Typing = talking. Only /end and /pause are commands; anything else with a
 *  leading slash is refused rather than sent (it was probably a typo). */
export function parseInput(raw: string): ParsedInput {
  const line = raw.trim();
  if (line === "") return { type: "empty" };
  if (!line.startsWith("/")) return { type: "message", text: line };

  const [command, arg] = line.split(/\s+/, 2);
  if (command === "/end") return { type: "end" };
  if (command === "/pause") {
    if (arg === "off") return { type: "pause-off" };
    const minutes = arg === undefined ? DEFAULT_PAUSE_MINUTES : Number(arg);
    if (Number.isFinite(minutes) && minutes > 0) {
      return { type: "pause", minutes };
    }
    return { type: "unknown-command", command: line };
  }
  return { type: "unknown-command", command };
}

export function formatIncoming(message: ChatMessage): string {
  if (message.kind === "system") return `· ${message.text}`;
  if (message.from === "user") return `[you] ${message.text}`;
  return `[${message.authorName ?? "expert"}] ${message.text}`;
}

const EVENT_LABELS: Record<string, string> = {
  prompt: "prompt",
  command: "last run",
  output: "output",
  edit: "file edit",
  agent_reply: "assistant reply",
};

/** The spec's subtle confirmation: "⟢ your last run is visible to Priya". */
export function formatEventConfirmation(
  message: ChatMessage,
  expertName: string | undefined,
): string {
  const label = EVENT_LABELS[message.eventType ?? ""] ?? "session activity";
  return `⟢ your ${label} is visible to ${expertName ?? "the expert"}`;
}
