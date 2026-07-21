/**
 * Permanent lead record.
 *
 * The session store (`sessions.ts`) and the durable cache (`persistence.ts`)
 * are both deliberately short-lived: sessions live in memory, and the Redis
 * mirror expires with the 72h max age. That is right for running a session and
 * wrong for knowing who ever asked for an expert.
 *
 * This module is the long-term book of record: one row per request, written to
 * Postgres, never expired, and untouched by a redeploy. It is append-and-update
 * only, and it is metadata only. It never stores file contents, terminal
 * output, browser data, chat history, the activity log, session tokens, or the
 * session rating (which stays unpersisted per the 2026-07-17 decision).
 *
 * Writes are best-effort: a lead write must never break a live session.
 */
import type { Pool } from "pg";
import type { Session } from "./sessions";

/** One row in the permanent leads table. Nulls, not undefined, for SQL binds. */
export interface LeadRow {
  sessionId: string;
  customerName: string;
  projectDir: string | null;
  issue: string | null;
  contextManifest: unknown | null;
  status: string;
  expertName: string | null;
  expertId: string | null;
  deliverySummary: string | null;
  deliveryAccepted: boolean | null;
  createdAt: Date;
  claimedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}

export interface LeadStore {
  /** Create the table and indexes if absent. Safe to call on every boot. */
  init(): Promise<void>;
  /** Insert or update the lead for a session. Never throws into callers. */
  record(session: Session): Promise<void>;
  /** Human-readable backend description, for the startup log. */
  describe(): string;
  close(): Promise<void>;
}

const at = (ms: number | undefined): Date | null =>
  typeof ms === "number" ? new Date(ms) : null;

/**
 * Project a live session down to its permanent lead record. Pure, so the
 * privacy boundary above is testable without a database.
 */
export function toLeadRow(session: Session): LeadRow {
  return {
    sessionId: session.id,
    customerName: session.customerName,
    projectDir: session.projectDir ?? null,
    issue: session.issue ?? null,
    contextManifest: session.contextManifest ?? null,
    status: session.status,
    expertName: session.expertName ?? null,
    expertId: session.expertId ?? null,
    deliverySummary: session.delivery?.summary ?? null,
    // `?? null` (not `|| null`) so an explicit false stays false.
    deliveryAccepted: session.delivery?.accepted ?? null,
    createdAt: new Date(session.createdAt),
    claimedAt: at(session.claimedAt),
    endedAt: at(session.endedAt),
    updatedAt: new Date(session.updatedAt),
  };
}

const SCHEMA = `
  create table if not exists leads (
    session_id        uuid primary key,
    customer_name     text        not null,
    project_dir       text,
    issue             text,
    context_manifest  jsonb,
    status            text        not null,
    expert_name       text,
    expert_id         text,
    delivery_summary  text,
    delivery_accepted boolean,
    created_at        timestamptz not null,
    claimed_at        timestamptz,
    ended_at          timestamptz,
    updated_at        timestamptz not null,
    recorded_at       timestamptz not null default now()
  );
  create index if not exists leads_created_at_idx on leads (created_at desc);
  create index if not exists leads_status_idx     on leads (status);
`;

const UPSERT = `
  insert into leads (
    session_id, customer_name, project_dir, issue, context_manifest, status,
    expert_name, expert_id, delivery_summary, delivery_accepted,
    created_at, claimed_at, ended_at, updated_at
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  on conflict (session_id) do update set
    status            = excluded.status,
    issue             = coalesce(excluded.issue, leads.issue),
    -- coalesce so a later snapshot that has lost a field (for example a
    -- restart-hydrated session) cannot blank out what we already recorded.
    expert_name       = coalesce(excluded.expert_name, leads.expert_name),
    expert_id         = coalesce(excluded.expert_id, leads.expert_id),
    delivery_summary  = coalesce(excluded.delivery_summary, leads.delivery_summary),
    delivery_accepted = coalesce(excluded.delivery_accepted, leads.delivery_accepted),
    context_manifest  = coalesce(excluded.context_manifest, leads.context_manifest),
    claimed_at        = coalesce(excluded.claimed_at, leads.claimed_at),
    ended_at          = coalesce(excluded.ended_at, leads.ended_at),
    updated_at        = greatest(excluded.updated_at, leads.updated_at)
`;

/** No database configured: the relay behaves exactly as it did before. */
export class NullLeadStore implements LeadStore {
  async init(): Promise<void> {}
  async record(): Promise<void> {}
  describe(): string {
    return "disabled (set LEADS_DATABASE_URL or DATABASE_URL to keep leads permanently)";
  }
  async close(): Promise<void> {}
}

export class PostgresLeadStore implements LeadStore {
  #pool: Pool | null = null;
  #ready: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** Lazy so `pg` is only imported when a database is actually configured. */
  async #getPool(): Promise<Pool> {
    if (this.#pool) return this.#pool;
    const { Pool: PgPool } = await import("pg");
    this.#pool = new PgPool({
      connectionString: this.url,
      max: 4,
      // Railway's Postgres proxy terminates TLS with its own certificate.
      ssl: this.url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    this.#pool.on("error", (err: Error) => this.log(`leads pool error: ${err.message}`));
    return this.#pool;
  }

  /**
   * Memoized: concurrent writes during startup would otherwise each re-run the
   * schema. Cleared on failure so a later write retries rather than being
   * stuck behind one bad boot.
   */
  init(): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#ready = (async () => {
      const pool = await this.#getPool();
      await pool.query(SCHEMA);
      this.log("permanent lead store: Postgres (leads kept indefinitely)");
    })().catch((err) => {
      this.#ready = null;
      throw err;
    });
    return this.#ready;
  }

  async record(session: Session): Promise<void> {
    // If a previous init() failed the relay still runs; this retries the schema
    // rather than losing every lead until the next redeploy.
    await this.init();
    const row = toLeadRow(session);
    const pool = await this.#getPool();
    await pool.query(UPSERT, [
      row.sessionId,
      row.customerName,
      row.projectDir,
      row.issue,
      row.contextManifest === null ? null : JSON.stringify(row.contextManifest),
      row.status,
      row.expertName,
      row.expertId,
      row.deliverySummary,
      row.deliveryAccepted,
      row.createdAt,
      row.claimedAt,
      row.endedAt,
      row.updatedAt,
    ]);
  }

  describe(): string {
    return `Postgres (${this.url.replace(/:\/\/[^@]*@/, "://***@")})`;
  }

  async close(): Promise<void> {
    await this.#pool?.end();
    this.#pool = null;
    this.#ready = null;
  }
}

/**
 * Pick the lead store from env. `LEADS_DATABASE_URL` wins so the leads book can
 * live in a different database from anything else the relay might use later.
 */
export function createLeadStore(
  envVars: Record<string, string | undefined> = process.env,
  log: (line: string) => void = () => {},
): LeadStore {
  const url = envVars.LEADS_DATABASE_URL?.trim() || envVars.DATABASE_URL?.trim() || "";
  if (!url) return new NullLeadStore();
  return new PostgresLeadStore(url, log);
}
