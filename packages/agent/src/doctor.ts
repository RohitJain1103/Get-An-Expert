import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { systemBrowserPaths } from "./browser-playwright";

/** Minimum Node major version the agent supports. */
const MIN_NODE_MAJOR = 18;

/** Native modules the agent depends on. Checked at startup so a failure to
 *  load surfaces as one plain-language line instead of a raw stack trace
 *  deep inside npx. */
const REQUIRED_NATIVE_MODULES = ["node-datachannel", "node-pty"] as const;

export interface DoctorIssue {
  message: string;
}

export interface DoctorResult {
  /** True when there are no fatal issues. */
  ok: boolean;
  /** Issues that should stop startup. */
  fatal: DoctorIssue[];
  /** Non-fatal notes worth telling the user about. */
  info: DoctorIssue[];
}

export interface DoctorOptions {
  /** process.versions.node by default; injectable for tests. */
  nodeVersion?: string;
  /** Attempts to load a native module by name, throwing on failure.
   *  Defaults to a real require() of the package. */
  loadNativeModule?: (name: string) => void;
  /** Reports whether a usable Chromium-family browser is present. Defaults
   *  to the same well-known-path list browser-playwright.ts falls back to
   *  when Playwright's own channel discovery finds nothing. */
  hasBrowser?: () => boolean;
}

/** Node-version check: fails with one specific line naming the version the
 *  user has, so it's actionable instead of a generic crash. */
export function checkNodeVersion(
  version: string = process.versions.node,
): DoctorIssue | undefined {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    return {
      message: `Get An Expert needs Node ${MIN_NODE_MAJOR} or newer. You have ${version}. Update Node and run it again.`,
    };
  }
  return undefined;
}

/** Native-module check: tries loading each required module and names the
 *  one(s) that fail, rather than letting the process crash on first use. */
export function checkNativeModules(
  loadNativeModule: (name: string) => void = defaultLoadNativeModule,
): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  for (const name of REQUIRED_NATIVE_MODULES) {
    try {
      loadNativeModule(name);
    } catch {
      issues.push({
        message: `Get An Expert could not load a required component (${name}). Reinstall dependencies and run it again.`,
      });
    }
  }
  return issues;
}

function defaultLoadNativeModule(name: string): void {
  const require = createRequire(import.meta.url);
  require(name);
}

/** Browser check: a missing browser is NOT fatal — the agent falls back to
 *  an HTTP check — so this only ever produces an informational note. */
export function checkBrowser(hasBrowser: () => boolean = defaultHasBrowser): DoctorIssue | undefined {
  if (hasBrowser()) return undefined;
  return {
    message:
      "No Chrome, Chromium, or Edge found. The expert will see your dev server as HTML instead of a live screenshot.",
  };
}

function defaultHasBrowser(): boolean {
  return systemBrowserPaths().some((path) => existsSync(path));
}

/**
 * Runs every preflight check once, at startup. Node-version and
 * native-module failures are fatal (stop startup before the server begins
 * serving); a missing browser is informational only.
 */
export function runDoctor(opts: DoctorOptions = {}): DoctorResult {
  const fatal: DoctorIssue[] = [];
  const info: DoctorIssue[] = [];

  const nodeIssue = checkNodeVersion(opts.nodeVersion);
  if (nodeIssue) fatal.push(nodeIssue);

  fatal.push(...checkNativeModules(opts.loadNativeModule));

  const browserIssue = checkBrowser(opts.hasBrowser);
  if (browserIssue) info.push(browserIssue);

  return { ok: fatal.length === 0, fatal, info };
}
