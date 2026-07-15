import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { PermissionGate } from "./permissions";
import type {
  ActivityEntry,
  BrowserController,
  ConsoleResult,
  ListFilesResult,
  ReadFileResult,
  RunCommandResult,
  ScreenshotResult,
} from "./types";

export interface AgentToolsOptions {
  gate: PermissionGate;
  browser: BrowserController;
  onActivity: (entry: ActivityEntry) => void;
  /** Max bytes returned from read_file (default 512 KB). */
  maxFileBytes?: number;
  /** Max entries returned from list_files (default 2000). */
  maxListEntries?: number;
  /** Default command timeout in ms (default 120s). */
  commandTimeoutMs?: number;
}

/** Directories never worth walking or surfacing to the expert. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", ".turbo"]);

/**
 * The permission-gated tool surface exposed to the expert. Every method checks
 * the PermissionGate first, performs the action on the customer's machine, and
 * emits an activity summary (action + target, never contents) so the customer
 * sees a live log of everything the expert does.
 */
export class AgentTools {
  readonly #gate: PermissionGate;
  readonly #browser: BrowserController;
  readonly #onActivity: (entry: ActivityEntry) => void;
  readonly #maxFileBytes: number;
  readonly #maxListEntries: number;
  readonly #commandTimeoutMs: number;

  constructor(opts: AgentToolsOptions) {
    this.#gate = opts.gate;
    this.#browser = opts.browser;
    this.#onActivity = opts.onActivity;
    this.#maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
    this.#maxListEntries = opts.maxListEntries ?? 2000;
    this.#commandTimeoutMs = opts.commandTimeoutMs ?? 120_000;
  }

  #log(kind: string, summary: string): void {
    this.#onActivity({ at: Date.now(), kind, summary });
  }

  #rel(absPath: string): string {
    const r = relative(this.#gate.projectDir, absPath);
    return r === "" ? "." : r;
  }

  async listFiles(dir = "."): Promise<ListFilesResult> {
    const root = this.#gate.checkFile(dir);
    const entries: ListFilesResult["entries"] = [];
    let truncated = false;

    const walk = async (current: string): Promise<void> => {
      if (entries.length >= this.#maxListEntries) {
        truncated = true;
        return;
      }
      const dirents = await readdir(current, { withFileTypes: true });
      for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= this.#maxListEntries) {
          truncated = true;
          return;
        }
        if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue;
        const abs = resolve(current, dirent.name);
        if (dirent.isDirectory()) {
          entries.push({ path: this.#rel(abs), type: "dir" });
          await walk(abs);
        } else if (dirent.isFile()) {
          let size: number | undefined;
          try {
            size = (await stat(abs)).size;
          } catch {
            size = undefined;
          }
          entries.push({ path: this.#rel(abs), type: "file", size });
        }
      }
    };

    await walk(root);
    this.#log("list_files", `Expert listing files: ${this.#rel(root)}`);
    return { entries, truncated };
  }

  async readFile(path: string): Promise<ReadFileResult> {
    const abs = this.#gate.checkFile(path);
    const buf = await readFile(abs);
    const truncated = buf.byteLength > this.#maxFileBytes;
    const content = buf.subarray(0, this.#maxFileBytes).toString("utf8");
    this.#log("read_file", `Expert reading: ${this.#rel(abs)}`);
    return { path: this.#rel(abs), content, truncated };
  }

  async writeFile(path: string, content: string): Promise<{ path: string }> {
    const abs = this.#gate.checkFile(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    this.#log("write_file", `Expert edited: ${this.#rel(abs)}`);
    return { path: this.#rel(abs) };
  }

  async runCommand(
    command: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<RunCommandResult> {
    this.#gate.checkTerminal();
    const timeoutMs = opts.timeoutMs ?? this.#commandTimeoutMs;
    this.#log("run_command", `Expert ran: ${truncateForLog(command)}`);

    return new Promise((resolvePromise) => {
      const child = spawn(command, {
        cwd: this.#gate.projectDir,
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const MAX = 1024 * 1024;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout?.on("data", (d) => {
        if (stdout.length < MAX) stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        if (stderr.length < MAX) stderr += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise({
          command,
          stdout,
          stderr: stderr + String(err),
          exitCode: null,
          timedOut,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({ command, stdout, stderr, exitCode: code, timedOut });
      });
    });
  }

  async browserScreenshot(port?: number): Promise<ScreenshotResult> {
    const resolved = this.#gate.checkBrowser(port);
    this.#log("browser_screenshot", `Expert viewing: localhost:${resolved}`);
    return this.#browser.screenshot(resolved);
  }

  async browserConsole(port?: number): Promise<ConsoleResult> {
    const resolved = this.#gate.checkBrowser(port);
    this.#log("browser_console", `Expert read console: localhost:${resolved}`);
    return this.#browser.console(resolved);
  }
}

function truncateForLog(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + "..." : oneLine;
}
