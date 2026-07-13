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

/** The guidance returned to the stuck user. */
export interface ExpertResponse {
  /** Warm 2-3 sentence human-voiced opener. */
  intro: string;
  /** Why they're stuck, in plain words. */
  diagnosis: string;
  /** The ready-to-paste prompt that should get them unstuck. */
  suggestedPrompt: string;
  /** Honest one-liner that this first pass is AI-assisted. */
  disclosure: string;
  model?: string;
  generatedAt: string;
}

export type ExpertRequestStatus = "new" | "answered" | "escalated" | "failed";

/** Consent metadata recorded with every request. */
export interface ConsentRecord {
  agreed: boolean;
  /** Version identifier of the consent text the user saw. */
  textVersion: string;
  /** ISO timestamp of when consent was given (as reported by client). */
  at: string;
}

/** What the backend stores. */
export interface ExpertRequestRecord {
  id: string;
  createdAt: string;
  status: ExpertRequestStatus;
  payload: ExpertRequestPayload;
  /** What the server-side re-redaction pass removed. */
  serverRedactions: RedactionSummary[];
  consent: ConsentRecord;
  response?: ExpertResponse;
}
