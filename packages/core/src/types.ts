/** Summary of what the redactor removed, grouped by secret type. */
export interface RedactionSummary {
  type: string;
  count: number;
}

/**
 * What the MCP client sends to the API. Assembled by the host model from the
 * session — never the raw transcript. Redacted client-side before sending.
 */
export interface ExpertRequestPayload {
  /** Host tool, e.g. "claude-code", "codex", "cursor". */
  tool: string;
  /** What the user is ultimately trying to achieve. */
  goal: string;
  /** Approaches already attempted, in order. */
  whatWasTried: string[];
  /** Error messages / failure output hit along the way. */
  errorMessages: string[];
  /** Narrative summary of the session so far. */
  conversationSummary: string;
  /** Languages/frameworks/services involved. */
  techStack: string[];
  /** Short label for the kind of expert needed, e.g. "React state management". */
  expertiseArea: string;
  /** How many user messages deep the session is. */
  messagesStuckCount?: number;
  /** Random per-install UUID; no account, no PII. */
  installId?: string;
  /** What the client-side redactor removed (types + counts only). */
  clientRedactions?: RedactionSummary[];
}

/**
 * One entry on a request's thread. Threads are append-only: user and expert
 * messages plus "activity" entries (consented progress updates, status
 * changes). `seq` is 1-based and assigned by the store on append.
 */
export interface ThreadMessage {
  seq: number;
  from: "user" | "expert";
  /** "message" = someone typed it; "activity" = system/progress entry. */
  kind: "message" | "activity";
  text: string;
  /** ISO timestamp. */
  at: string;
}

/** Input shape for appends — the store assigns `seq`. */
export type NewThreadMessage = Omit<ThreadMessage, "seq">;

/**
 * new      → submitted, no expert engaged yet
 * live     → an expert has claimed or replied (also set when a user message
 *            reopens a solved thread)
 * solved   → the expert marked it resolved; the thread stays reopenable
 *            until the record's 30-day expiry
 */
export type ExpertRequestStatus = "new" | "live" | "solved";

/** Consent metadata recorded with every request. */
export interface ConsentRecord {
  agreed: boolean;
  /** Version identifier of the consent text the user saw. */
  textVersion: string;
  /** ISO timestamp of when consent was given (as reported by client). */
  at: string;
}

/** What the backend stores. Thread messages live beside it, keyed by id. */
export interface ExpertRequestRecord {
  id: string;
  createdAt: string;
  status: ExpertRequestStatus;
  payload: ExpertRequestPayload;
  /** What the server-side re-redaction pass removed. */
  serverRedactions: RedactionSummary[];
  consent: ConsentRecord;
  /** Display name of the expert who claimed the thread. */
  expertName?: string;
  /** ISO timestamp of the latest thread activity (createdAt until then). */
  lastActivityAt?: string;
}
