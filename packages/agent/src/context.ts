import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { redactText } from "@get-an-expert/core";

/**
 * Expert hand-off context: pure, defensive helpers that assemble the
 * `.get-an-expert/CONTEXT.md` file the expert opens first. Sources are the
 * agent's hand-off summary, the customer's consented conversation transcript
 * (pointer written by the plugin's PreToolUse hook), and the project's own
 * overview file. Everything here stays local + peer-to-peer — nothing is
 * sent to the relay — and every function fails soft: a missing, stale, or
 * corrupt source degrades the file, it never blocks the expert request.
 * The assembled markdown is secret-redacted before it is returned.
 */

/** Pointer is useless once the conversation has moved on; treat as stale. */
const POINTER_MAX_AGE_MS = 10 * 60 * 1000;

/** Cap how much transcript we read so huge sessions stay O(1) I/O. */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

/** Cap the rendered transcript so CONTEXT.md stays readable. */
const MAX_TRANSCRIPT_MARKDOWN_BYTES = 200 * 1024;

/** Overview excerpt size — enough for a project's shape, not its guts. */
const MAX_OVERVIEW_BYTES = 4 * 1024;

/** Overview candidates, most agent-oriented first. */
const OVERVIEW_FILES = ["CLAUDE.md", "README.md"] as const;

const TRUNCATION_NOTE =
  "_Transcript truncated — older messages omitted; the most recent conversation follows._";

const pointerSchema = z.object({
  transcriptPath: z.string().min(1),
  sessionId: z.string().optional(),
  savedAt: z.number(),
});

export type TranscriptPointer = z.infer<typeof pointerSchema>;

export interface ProjectOverview {
  /** Which candidate file the excerpt came from (relative to projectDir). */
  file: string;
  excerpt: string;
}

export interface ContextInput {
  customerName: string;
  issue?: string;
  summary: string;
  overview: ProjectOverview | null;
  transcriptMarkdown?: string;
  requestedAt: number;
}

/** Local state directory shared with the plugin hooks. */
function stateHome(): string {
  return process.env.GET_AN_EXPERT_HOME?.trim() || join(homedir(), ".get-an-expert");
}

/**
 * Read the transcript pointer the plugin's PreToolUse hook wrote just before
 * request_expert_help was called. Null when missing, corrupt, or older than
 * ten minutes — the caller degrades to summary-only context.
 */
export function readTranscriptPointer(now = Date.now()): TranscriptPointer | null {
  try {
    const raw = readFileSync(join(stateHome(), "transcript-pointer.json"), "utf8");
    const pointer = pointerSchema.parse(JSON.parse(raw));
    if (now - pointer.savedAt > POINTER_MAX_AGE_MS) return null;
    // Defense in depth: only follow an absolute path to a transcript file.
    if (!isAbsolute(pointer.transcriptPath) || !pointer.transcriptPath.endsWith(".jsonl")) {
      return null;
    }
    return pointer;
  } catch {
    return null;
  }
}

/** Read the whole transcript, or just its last maxBytes if huge. */
export function readTranscriptTail(path: string, maxBytes = MAX_TRANSCRIPT_BYTES): string {
  const size = statSync(path).size;
  if (size <= maxBytes) return readFileSync(path, "utf8");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const bytes = readSync(fd, buf, 0, maxBytes, size - maxBytes);
    return buf.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

interface ContentBlock {
  type?: string;
  text?: string;
}

/** Text from a message content value (string or array of blocks). */
function blockText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => (block.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Tool results arrive as user-type entries; they are not the human talking. */
function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    (content as ContentBlock[]).some((block) => block?.type === "tool_result")
  );
}

/**
 * Render a Claude Code JSONL transcript as a readable dialogue. Keeps only
 * real user prompts and assistant prose — tool calls, tool results, meta
 * entries, and unparseable lines are skipped. The transcript format is not
 * stable, so any line that doesn't fit is dropped, never fatal. Output is
 * capped; when over budget the OLDEST messages are dropped and a note says so.
 */
export function transcriptToMarkdown(
  jsonl: string,
  maxBytes = MAX_TRANSCRIPT_MARKDOWN_BYTES,
): string {
  const sections: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: string; isMeta?: boolean; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // garbage line — skip
    }
    if (entry?.type === "user" && !entry.isMeta) {
      const content = entry.message?.content;
      if (hasToolResult(content)) continue;
      const text = blockText(content);
      if (text) sections.push(`**User:**\n${text}`);
    } else if (entry?.type === "assistant") {
      const content = entry.message?.content;
      const text = Array.isArray(content) ? blockText(content) : "";
      if (text) sections.push(`**Assistant:**\n${text}`);
    }
  }
  if (sections.length === 0) return "";

  // Drop oldest sections until the rendered dialogue fits the cap.
  let truncated = false;
  let total = sections.reduce((n, s) => n + Buffer.byteLength(s, "utf8") + 2, 0);
  let start = 0;
  while (start < sections.length - 1 && total > maxBytes) {
    total -= Buffer.byteLength(sections[start], "utf8") + 2;
    start += 1;
    truncated = true;
  }
  let joined = sections.slice(start).join("\n\n");
  // A single oversized message can still blow the cap — hard-trim its head.
  if (Buffer.byteLength(joined, "utf8") > maxBytes) {
    const buf = Buffer.from(joined, "utf8");
    joined = buf.subarray(buf.length - maxBytes).toString("utf8");
    truncated = true;
  }
  return truncated ? `${TRUNCATION_NOTE}\n\n${joined}` : joined;
}

/** Read only the head of a file — the overview excerpt never needs more. */
function readHead(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const bytes = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

/**
 * A short project overview from files that already exist — CLAUDE.md
 * preferred, README.md as fallback — so building context adds zero
 * generation delay. Null when neither file is present or readable.
 */
export function readProjectOverview(
  projectDir: string,
  maxBytes = MAX_OVERVIEW_BYTES,
): ProjectOverview | null {
  for (const file of OVERVIEW_FILES) {
    const path = join(projectDir, file);
    try {
      if (!statSync(path).isFile()) continue;
      const excerpt = readHead(path, maxBytes).trim();
      if (excerpt) return { file, excerpt };
    } catch {
      // missing or unreadable — try the next candidate
    }
  }
  return null;
}

/**
 * Assemble CONTEXT.md: header + gitignore note, the agent's hand-off
 * summary, the project overview (omitted when none), and the conversation
 * transcript (with an explicit fallback line when unavailable). The whole
 * document is secret-redacted before it is returned, and a footnote reports
 * how many secrets were removed.
 */
export function buildContextMarkdown(input: ContextInput): string {
  const parts: string[] = [
    "# Get An Expert — session context",
    [
      `- **Customer:** ${input.customerName}`,
      `- **Issue:** ${input.issue?.trim() || "(not provided)"}`,
      `- **Requested:** ${new Date(input.requestedAt).toISOString()}`,
    ].join("\n"),
    "_Generated for this expert session and deleted when it ends. Keep `.get-an-expert/` in your `.gitignore` — don't commit it._",
    "## Where they're stuck (agent summary)",
    input.summary.trim(),
  ];
  if (input.overview) {
    parts.push(
      "## Project overview",
      input.overview.excerpt,
      `_Full overview: ${input.overview.file}_`,
    );
  }
  parts.push(
    "## Conversation transcript",
    input.transcriptMarkdown?.trim() || "Not available — work from the summary above.",
  );

  const { text, redactions } = redactText(parts.join("\n\n"));
  const count = redactions.reduce((n, r) => n + r.count, 0);
  if (count === 0) return `${text}\n`;
  return `${text}\n\n_${count} secret${count === 1 ? " was" : "s were"} redacted._\n`;
}
