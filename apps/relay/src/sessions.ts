import { randomUUID } from "node:crypto";
import { NO_PERMISSIONS, type Permissions } from "./protocol";

export type SessionStatus = "waiting" | "active" | "ended";

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
  status: SessionStatus;
  expertName?: string;
  createdAt: number;
  claimedAt?: number;
  endedAt?: number;
  permissions: Permissions;
  activity: readonly ActivityEntry[];
}

export interface CreateSessionInput {
  customerName: string;
  projectDir: string;
  issue?: string;
}

/** Keep at most this many activity summaries per session. */
const ACTIVITY_CAP = 500;
/** Keep at most this many ended sessions around for metadata queries. */
const ENDED_CAP = 200;

/**
 * In-memory session registry. Session metadata only — never file contents,
 * terminal output, or browser data. Every update replaces the stored session
 * with a new object; snapshots handed out earlier are never mutated.
 */
export class SessionStore {
  #sessions = new Map<string, Session>();

  create(input: CreateSessionInput): Session {
    const session: Session = {
      id: randomUUID(),
      customerName: input.customerName,
      projectDir: input.projectDir,
      issue: input.issue,
      status: "waiting",
      createdAt: Date.now(),
      permissions: { ...NO_PERMISSIONS },
      activity: [],
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  claim(id: string, expertName: string): Session {
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
    this.#sessions.set(session.id, session);
    return session;
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
