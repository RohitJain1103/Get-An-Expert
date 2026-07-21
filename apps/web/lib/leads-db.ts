/**
 * Read-only view of the relay's permanent leads table.
 *
 * The relay owns the schema (`apps/relay/src/leads.ts`); this module only
 * queries it, so the dashboard can never corrupt the book of record. Point
 * LEADS_DATABASE_URL at the same Postgres the relay writes to. On Railway that
 * is the public connection string (DATABASE_PUBLIC_URL), because this app runs
 * on Vercel and cannot reach Railway's private network.
 */
import { Pool } from "pg";

export interface Lead {
  sessionId: string;
  customerName: string;
  projectDir: string | null;
  issue: string | null;
  status: "waiting" | "active" | "ended" | string;
  expertName: string | null;
  deliverySummary: string | null;
  deliveryAccepted: boolean | null;
  createdAt: Date;
  claimedAt: Date | null;
  endedAt: Date | null;
}

export interface LeadStats {
  total: number;
  last7Days: number;
  last30Days: number;
  /** Leads an expert actually claimed. */
  claimed: number;
  /** Leads where the expert delivered something. */
  delivered: number;
  /** Still waiting for an expert right now. */
  waiting: number;
  /** Ended without an expert ever claiming it: the leads you lost. */
  missed: number;
}

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url =
    process.env.LEADS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** True when a leads database is configured, so the page can explain itself. */
export const leadsConfigured = (): boolean => getPool() !== null;

interface LeadRecord {
  session_id: string;
  customer_name: string;
  project_dir: string | null;
  issue: string | null;
  status: string;
  expert_name: string | null;
  delivery_summary: string | null;
  delivery_accepted: boolean | null;
  created_at: Date;
  claimed_at: Date | null;
  ended_at: Date | null;
}

const toLead = (r: LeadRecord): Lead => ({
  sessionId: r.session_id,
  customerName: r.customer_name,
  projectDir: r.project_dir,
  issue: r.issue,
  status: r.status,
  expertName: r.expert_name,
  deliverySummary: r.delivery_summary,
  deliveryAccepted: r.delivery_accepted,
  createdAt: r.created_at,
  claimedAt: r.claimed_at,
  endedAt: r.ended_at,
});

/** Most recent leads first. `search` filters on name and issue text. */
export async function listLeads(limit = 200, search = ""): Promise<Lead[]> {
  const db = getPool();
  if (!db) return [];
  const term = search.trim();
  // Parameterized: `term` is user input from the query string.
  const { rows } = term
    ? await db.query<LeadRecord>(
        `select * from leads
         where customer_name ilike $1 or issue ilike $1
         order by created_at desc limit $2`,
        [`%${term}%`, limit],
      )
    : await db.query<LeadRecord>(
        `select * from leads order by created_at desc limit $1`,
        [limit],
      );
  return rows.map(toLead);
}

export async function leadStats(): Promise<LeadStats> {
  const db = getPool();
  if (!db) {
    return {
      total: 0,
      last7Days: 0,
      last30Days: 0,
      claimed: 0,
      delivered: 0,
      waiting: 0,
      missed: 0,
    };
  }
  const { rows } = await db.query<Record<string, string>>(`
    select
      count(*)                                                          as total,
      count(*) filter (where created_at > now() - interval '7 days')     as last7,
      count(*) filter (where created_at > now() - interval '30 days')    as last30,
      count(*) filter (where claimed_at is not null)                     as claimed,
      count(*) filter (where delivery_summary is not null)               as delivered,
      count(*) filter (where status = 'waiting')                         as waiting,
      count(*) filter (where status = 'ended' and claimed_at is null)     as missed
    from leads
  `);
  const r = rows[0] ?? {};
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    total: n(r.total),
    last7Days: n(r.last7),
    last30Days: n(r.last30),
    claimed: n(r.claimed),
    delivered: n(r.delivered),
    waiting: n(r.waiting),
    missed: n(r.missed),
  };
}
