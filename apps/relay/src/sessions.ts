import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  NO_PERMISSIONS,
  type ChatMessage,
  type ContextManifest,
  type Permissions,
} from "./protocol";

export type SessionStatus = "waiting" | "active" | "ended";

/** SHA-256 of a resume token — the only form ever stored or persisted. */
export function hashResumeToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ActivityEntry {
  at: number;
  kind: string;
  summary: string;
}

export interface Session {
  id: string;
  customerName: string;
  projectDir: string;
  issue?: string;
  /** Epoch ms of the last issue edit, and who made it. Absent until the issue
   * is first edited (the original issue from register is not an "edit"). Used
   * by the customer-always-wins conflict rule. */
  issueEditedAt?: number;
  issueEditedBy?: "customer" | "expert";
  /** Count-bearing description of the expert's CONTEXT.md, sent at register and
   * echoed to the customer chat page as truthful chips. */
  contextManifest?: ContextManifest;
  status: SessionStatus;
  /**
   * Whether the customer's agent socket is currently attached. A request stays
   * in the queue while offline (the customer walked away / lost the network /
   * the relay restarted) so an expert can still see it and pick it up once the
   * machine reconnects. Only an explicit end (or max-age expiry) removes it.
   */
  online: boolean;
  expertName?: string;
  /** Roster id of the claiming expert, when they self-selected an identity. */
  expertId?: string;
  createdAt: number;
  /** Epoch ms of the last mutation, so callers can show freshness. */
  updatedAt: number;
  claimedAt?: number;
  endedAt?: number;
  permissions: Permissions;
  activity: readonly ActivityEntry[];
  /**
   * Bearer token for the customer chat page. Shared only with the customer's
   * own agent (in the `registered` reply) — it must NEVER appear in queue
   * entries or anything else sent to experts.
   */
  customerToken: string;
  /**
   * SHA-256 of the resume token. The raw token is returned to the agent once
   * at create and never stored; a reconnecting agent presents it and the relay
   * compares hashes. Never included in queue entries.
   */
  resumeTokenHash: string;
  /** Chat history, already redacted. Never included in queue entries. */
  chat: readonly ChatMessage[];
}

export interface CreateSessionInput {
  customerName: string;
  projectDir: string;
  issue?: string;
  contextManifest?: ContextManifest;
}

/** Keep at most this many activity summaries per session. */
const ACTIVITY_CAP = 500;
/** Keep at most this many ended sessions around for metadata queries. */
const ENDED_CAP = 200;
/** Keep at most this many chat messages per session (oldest dropped). */
const CHAT_CAP = 200;

/**
 * In-memory session registry. Session metadata only — never file contents,
 * terminal output, or browser data. Every update replaces the stored session
 * with a new object; snapshots handed out earlier are never mutated.
 */
export class SessionStore {
  #sessions = new Map<string, Session>();

  /**
   * Register a new waiting session. Returns the session plus the raw resume
   * token (returned to the agent exactly once; only its hash is stored).
   */
  create(input: CreateSessionInput): { session: Session; resumeToken: string } {
    const now = Date.now();
    const resumeToken = randomBytes(24).toString("hex");
    const session: Session = {
      id: randomUUID(),
      customerName: input.customerName,
      projectDir: input.projectDir,
      issue: input.issue,
      contextManifest: input.contextManifest,
      status: "waiting",
      online: true,
      createdAt: now,
      updatedAt: now,
      permissions: { ...NO_PERMISSIONS },
      activity: [],
      customerToken: randomBytes(16).toString("hex"),
      resumeTokenHash: hashResumeToken(resumeToken),
      chat: [],
    };
    this.#sessions.set(session.id, session);
    return { session, resumeToken };
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  /** Mark whether the customer's agent socket is attached. */
  setOnline(id: string, online: boolean): Session {
    const session = this.#require(id);
    return this.#update({ ...session, online });
  }

  /**
   * Insert a session restored from durable storage as offline. Never clobbers a
   * session that is already live in memory (a reconnect wins over a stale copy).
   */
  hydrate(session: Session): void {
    if (this.#sessions.has(session.id)) return;
    this.#sessions.set(session.id, { ...session, online: false });
  }

  /**
   * Ids of non-ended sessions created before the cutoff that are unclaimed or
   * offline — the max-age sweep ends these so the durable inbox (and the
   * grants an auto-resume could re-arm) never lingers indefinitely. A session
   * actively being worked on (active + online) is left alone regardless of age.
   */
  expireBefore(cutoffMs: number): string[] {
    const ids: string[] = [];
    for (const s of this.#sessions.values()) {
      if (s.status === "ended") continue;
      if (s.createdAt >= cutoffMs) continue;
      if (s.status === "waiting" || !s.online) ids.push(s.id);
    }
    return ids;
  }

  claim(id: string, expertName: string, expertId?: string): Session {
    const session = this.#require(id);
    if (session.status === "active") {
      throw new Error(
        `Session ${id} is already claimed by ${session.expertName}`,
      );
    }
    if (session.status === "ended") {
      throw new Error(`Session ${id} has already ended`);
    }
    return this.#update({
      ...session,
      status: "active",
      expertName,
      expertId,
      claimedAt: Date.now(),
    });
  }

  release(id: string): Session {
    const session = this.#require(id);
    if (session.status === "ended") return session;
    return this.#update({
      ...session,
      status: "waiting",
      expertName: undefined,
      expertId: undefined,
      claimedAt: undefined,
    });
  }

  end(id: string, reason?: string): Session | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    const ended = this.#update({
      ...session,
      status: "ended",
      endedAt: Date.now(),
      activity: reason
        ? [
            ...session.activity,
            { at: Date.now(), kind: "session-end", summary: reason },
          ]
        : session.activity,
    });
    this.#pruneEnded();
    return ended;
  }

  setPermissions(id: string, permissions: Permissions): Session {
    const session = this.#require(id);
    return this.#update({ ...session, permissions: { ...permissions } });
  }

  /**
   * Replace the issue text and stamp who edited it and when. The relay redacts
   * the text before calling this (same treatment as chat), so the stored issue
   * is already safe to fan out.
   */
  setIssue(id: string, text: string, by: "customer" | "expert"): Session {
    const session = this.#require(id);
    return this.#update({
      ...session,
      issue: text,
      issueEditedAt: Date.now(),
      issueEditedBy: by,
    });
  }

  addChat(id: string, message: ChatMessage): Session {
    const session = this.#require(id);
    const chat = [...session.chat, message].slice(-CHAT_CAP);
    return this.#update({ ...session, chat });
  }

  addActivity(id: string, entry: { kind: string; summary: string }): Session {
    const session = this.#require(id);
    const activity = [
      ...session.activity,
      { at: Date.now(), kind: entry.kind, summary: entry.summary },
    ].slice(-ACTIVITY_CAP);
    return this.#update({ ...session, activity });
  }

  /** Waiting + active sessions, oldest first. */
  queue(): Session[] {
    return [...this.#sessions.values()]
      .filter((s) => s.status !== "ended")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  #require(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`Unknown session ${id}`);
    return session;
  }

  #update(session: Session): Session {
    const stamped = { ...session, updatedAt: Date.now() };
    this.#sessions.set(session.id, stamped);
    return stamped;
  }

  #pruneEnded(): void {
    const ended = [...this.#sessions.values()]
      .filter((s) => s.status === "ended")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (ended.length > ENDED_CAP) {
      const oldest = ended.shift()!;
      this.#sessions.delete(oldest.id);
    }
  }
}
