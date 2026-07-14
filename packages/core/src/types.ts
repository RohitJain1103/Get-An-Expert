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
 * new      → submitted, no expert engaged yet
 * live     → an expert has joined the chat
 * solved   → the expert marked it resolved (reserved for the dashboard flow)
 */
export type ExpertRequestStatus = "new" | "live" | "solved";

/** Who authored a chat message or action. */
export type ChatRole = "user" | "expert";

/** Session activity relayed from the user's working session. */
export type RelayEventType =
  | "prompt"
  | "command"
  | "output"
  | "edit"
  | "agent_reply";

/** A single line in the live user↔expert chat. */
export interface ChatMessage {
  /** 1-based position in the request's message list; assigned by the store. */
  seq: number;
  /** ISO timestamp. */
  at: string;
  from: ChatRole;
  /** Display name for expert messages (e.g. "Priya"); absent for the user. */
  authorName?: string;
  /**
   * "system" lines are join/end notices; "event" lines are relayed session
   * activity — both rendered differently from plain messages by clients.
   */
  kind: "message" | "system" | "event";
  /** Set only when kind === "event". */
  eventType?: RelayEventType;
  text: string;
}

/** A ChatMessage before the store assigns its seq. */
export type NewChatMessage = Omit<ChatMessage, "seq">;

export type ChatSessionStatus = "active" | "ended";

/**
 * Live-chat state carried on the request record. "ended" is a hard stop:
 * the server refuses further messages and relayed events (HTTP 410) and it
 * can never restart.
 */
export interface ChatState {
  status: ChatSessionStatus;
  startedAt: string;
  /** Set when the expert first posts; drives the one-time join notice. */
  expertJoinedAt?: string;
  expertName?: string;
  endedAt?: string;
  endedBy?: ChatRole;
}

/** Consent metadata recorded with every request. */
export interface ConsentRecord {
  agreed: boolean;
  /** Version identifier of the consent text the user saw. */
  textVersion: string;
  /** ISO timestamp of when consent was given (as reported by client). */
  at: string;
}

/** What the backend stores. Chat messages live beside it, keyed by id. */
export interface ExpertRequestRecord {
  id: string;
  createdAt: string;
  status: ExpertRequestStatus;
  payload: ExpertRequestPayload;
  /** What the server-side re-redaction pass removed. */
  serverRedactions: RedactionSummary[];
  consent: ConsentRecord;
  /** Live-chat state; present once a chat-capable request is created. */
  chat?: ChatState;
  /** Display name of the expert who joined the chat (dashboard listing). */
  expertName?: string;
  /** ISO timestamp of the latest chat activity (createdAt until then). */
  lastActivityAt?: string;
}
