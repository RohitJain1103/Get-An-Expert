/**
 * `get-an-expert init <host>` — installs the session-relay wiring:
 *   1. copies the bundled relay script to ~/.get-an-expert/relay.mjs
 *   2. merges observe-only hook entries into the host's hooks config
 * Merging is additive and idempotent: existing user hooks are never touched,
 * and re-running init never duplicates entries. The hooks are inert until an
 * escalation writes relay.json (and again the moment it is cleared).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expertHomeDir } from "@get-an-expert/core/relay";

const CURSOR_EVENTS = [
  "beforeSubmitPrompt",
  "afterShellExecution",
  "afterFileEdit",
  "afterAgentResponse",
] as const;

const WINDSURF_EVENTS = [
  "pre_user_prompt",
  "post_run_command",
  "post_write_code",
  "post_cascade_response",
] as const;

type HookEntry = Record<string, unknown> & { command?: unknown };

const isOurs = (entry: HookEntry): boolean =>
  typeof entry.command === "string" &&
  (entry.command.includes("relay.mjs") ||
    entry.command.includes("get-an-expert"));

function asConfig(existing: unknown): Record<string, unknown> {
  return typeof existing === "object" && existing !== null
    ? { ...(existing as Record<string, unknown>) }
    : {};
}

function asHooks(config: Record<string, unknown>): Record<string, HookEntry[]> {
  const hooks = config.hooks;
  if (typeof hooks !== "object" || hooks === null) return {};
  const copy: Record<string, HookEntry[]> = {};
  for (const [key, value] of Object.entries(hooks)) {
    copy[key] = Array.isArray(value) ? [...(value as HookEntry[])] : [];
  }
  return copy;
}

function appendMissing(
  hooks: Record<string, HookEntry[]>,
  events: readonly string[],
  makeEntry: (event: string) => HookEntry,
): Record<string, HookEntry[]> {
  const next = { ...hooks };
  for (const event of events) {
    const entries = next[event] ?? [];
    next[event] = entries.some(isOurs)
      ? entries
      : [...entries, makeEntry(event)];
  }
  return next;
}

/** Cursor: {version:1, hooks:{<event>:[{command}]}} — JSON on stdin. */
export function mergeCursorHooks(existing: unknown, relayPath: string): object {
  const config = asConfig(existing);
  return {
    ...config,
    version: typeof config.version === "number" ? config.version : 1,
    hooks: appendMissing(asHooks(config), CURSOR_EVENTS, (event) => ({
      command: `node "${relayPath}" cursor ${event}`,
    })),
  };
}

/** Windsurf: {hooks:{<event>:[{command, powershell?}]}} — bash -c on mac/linux. */
export function mergeWindsurfHooks(
  existing: unknown,
  relayPath: string,
): object {
  const config = asConfig(existing);
  return {
    ...config,
    hooks: appendMissing(asHooks(config), WINDSURF_EVENTS, (event) => ({
      command: `node "${relayPath}" windsurf ${event}`,
      powershell: `node "${relayPath}" windsurf ${event}`,
      show_output: false,
    })),
  };
}

/** Copies the bundled relay script next to the flag file. Returns its path. */
export function installRelayScript(): string {
  const source = fileURLToPath(new URL("relay.js", import.meta.url));
  const target = join(expertHomeDir(), "relay.mjs");
  mkdirSync(expertHomeDir(), { recursive: true, mode: 0o700 });
  copyFileSync(source, target);
  return target;
}

function cursorHooksPath(): string {
  return join(
    process.env.GET_AN_EXPERT_CURSOR_DIR ?? join(homedir(), ".cursor"),
    "hooks.json",
  );
}

function windsurfHooksPath(): string {
  return join(
    process.env.GET_AN_EXPERT_WINDSURF_DIR ??
      join(homedir(), ".codeium", "windsurf"),
    "hooks.json",
  );
}

function mergeIntoFile(
  path: string,
  merge: (existing: unknown, relayPath: string) => object,
  relayPath: string,
): void {
  let existing: unknown = null;
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Corrupt config: keep a copy, then start fresh rather than crash.
      copyFileSync(path, `${path}.gae-backup`);
    }
    if (existing !== null && !existsSync(`${path}.gae-backup`)) {
      copyFileSync(path, `${path}.gae-backup`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merge(existing, relayPath), null, 2)}\n`);
}

export type InitHost = "claude-code" | "cursor" | "windsurf";

/** Returns human-readable lines describing what was installed. */
export function runInit(host: InitHost): string[] {
  const relayPath = installRelayScript();
  const lines = [`Relay script installed: ${relayPath}`];
  if (host === "cursor") {
    mergeIntoFile(cursorHooksPath(), mergeCursorHooks, relayPath);
    lines.push(`Cursor hooks wired: ${cursorHooksPath()}`);
  } else if (host === "windsurf") {
    mergeIntoFile(windsurfHooksPath(), mergeWindsurfHooks, relayPath);
    lines.push(`Windsurf hooks wired: ${windsurfHooksPath()}`);
  } else {
    lines.push(
      "Claude Code hooks ship with the Get An Expert plugin — nothing else to wire.",
    );
  }
  lines.push(
    "Relaying only happens while an expert chat you consented to is open.",
  );
  return lines;
}
