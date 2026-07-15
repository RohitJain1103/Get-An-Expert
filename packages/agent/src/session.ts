import type { ActivityEntry, Grant, SessionSummary } from "./types";

export interface SessionLogOptions {
  /** Max entries retained (default 1000). */
  cap?: number;
}

export interface SummaryInput {
  expertName?: string;
  startedAt: number;
  endedAt: number;
  permissions: Grant;
}

/** Prefixes used by AgentTools activity summaries, so the summary builder can
 * recover the target file / command from the human-readable line. */
const EDITED_PREFIX = "Expert edited: ";
const RAN_PREFIX = "Expert ran: ";

/**
 * The live activity log for one session. It holds action summaries the
 * customer watches in real time, and builds the post-session summary
 * (files modified, commands run, duration) from those same entries.
 */
export class SessionLog {
  #entries: ActivityEntry[] = [];
  readonly #cap: number;

  constructor(opts: SessionLogOptions = {}) {
    this.#cap = opts.cap ?? 1000;
  }

  record(entry: ActivityEntry): void {
    this.#entries = [...this.#entries, entry].slice(-this.#cap);
  }

  entries(): readonly ActivityEntry[] {
    return [...this.#entries];
  }

  summary(input: SummaryInput): SessionSummary {
    const filesModified: string[] = [];
    const commandsRun: string[] = [];
    for (const entry of this.#entries) {
      if (entry.kind === "write_file" && entry.summary.startsWith(EDITED_PREFIX)) {
        const file = entry.summary.slice(EDITED_PREFIX.length);
        if (!filesModified.includes(file)) filesModified.push(file);
      } else if (entry.kind === "run_command" && entry.summary.startsWith(RAN_PREFIX)) {
        commandsRun.push(entry.summary.slice(RAN_PREFIX.length));
      }
    }
    return {
      expertName: input.expertName,
      durationMs: Math.max(0, input.endedAt - input.startedAt),
      filesModified,
      commandsRun,
      finalPermissions: input.permissions,
      activityCount: this.#entries.length,
    };
  }
}
