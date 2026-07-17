import type { Grant } from "./permissions";

export type { Grant, Scope } from "./permissions";

/** A single logged expert action. Action + target only — never file contents,
 * command output, or browser data. This is what the customer sees live. */
export interface ActivityEntry {
  at: number;
  kind: string;
  summary: string;
}

export interface FileEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface ListFilesResult {
  entries: FileEntry[];
  truncated: boolean;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RunCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ScreenshotResult {
  ok: boolean;
  port: number;
  status?: number;
  title?: string;
  contentType?: string;
  note: string;
  /** Optional base64 PNG when a real headless browser controller is used. */
  imageBase64?: string;
  /**
   * Truncated HTML source of the page. The HTTP fallback fills this in when no
   * headless browser is available, so the expert can at least read the markup
   * instead of seeing only an HTTP status code.
   */
  html?: string;
}

export interface ConsoleEntry {
  level: string;
  text: string;
}

export interface ConsoleResult {
  port: number;
  entries: ConsoleEntry[];
  note?: string;
}

/** Pluggable browser capability. The default drives a real headless browser
 * (screenshot + console) and falls back to HTTP checks when none is present. */
export interface BrowserController {
  screenshot(port: number): Promise<ScreenshotResult>;
  console(port: number): Promise<ConsoleResult>;
  /** Release any browser resources held for the session. */
  close?(): Promise<void>;
}

/**
 * The public expert profile, exactly as the relay puts it on the wire
 * (expert-joined / hello-ok). Defined structurally here rather than imported
 * from apps/relay, which is not a workspace dependency of this package; only
 * this subset ever crosses the peer boundary. Every field is treated as
 * untrusted and optional at render time, so a partial profile never leaks
 * "undefined" into customer-facing copy.
 */
export interface PublicExpertProfile {
  id: string;
  name: string;
  photo: string;
  role: string;
  companies: { logo?: string; label: string }[];
  tag: string;
  rating: number;
  fixesDelivered: number;
  linkedin?: string;
}

/** Session-summary shape handed to the customer when the session ends. */
export interface SessionSummary {
  expertName?: string;
  durationMs: number;
  filesModified: string[];
  commandsRun: string[];
  finalPermissions: Grant;
  activityCount: number;
}
