import { isAbsolute, resolve, sep } from "node:path";

export type Scope = "files" | "terminal" | "browser";

export interface Grant {
  files: boolean;
  terminal: boolean;
  browser: boolean;
  browserPort?: number;
}

/** Thrown when a tool is called without the required scope, or out of bounds. */
export class PermissionDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDenied";
  }
}

/**
 * The consent gate that runs before every expert tool call on the customer's
 * machine. It enforces three things the customer approved:
 *
 *  - files:    read/write only inside the project directory (no traversal out)
 *  - terminal: run commands (in the project directory)
 *  - browser:  view only the one localhost port that was approved
 *
 * Nothing is granted until the customer approves it, and the customer can
 * revoke any scope mid-session — a revoked scope makes the next matching tool
 * call throw immediately.
 */
export class PermissionGate {
  readonly #projectDir: string;
  #files = false;
  #terminal = false;
  #browser = false;
  #browserPort?: number;

  constructor(projectDir: string) {
    this.#projectDir = resolve(projectDir);
  }

  get projectDir(): string {
    return this.#projectDir;
  }

  grant(grant: Grant): void {
    this.#files = grant.files;
    this.#terminal = grant.terminal;
    this.#browser = grant.browser;
    this.#browserPort = grant.browser ? grant.browserPort : undefined;
  }

  revoke(scope: Scope): void {
    if (scope === "files") this.#files = false;
    if (scope === "terminal") this.#terminal = false;
    if (scope === "browser") {
      this.#browser = false;
      this.#browserPort = undefined;
    }
  }

  revokeAll(): void {
    this.#files = false;
    this.#terminal = false;
    this.#browser = false;
    this.#browserPort = undefined;
  }

  snapshot(): Grant {
    const grant: Grant = {
      files: this.#files,
      terminal: this.#terminal,
      browser: this.#browser,
    };
    if (this.#browserPort !== undefined) grant.browserPort = this.#browserPort;
    return grant;
  }

  /**
   * Validate a file path against the files scope and project containment.
   * Returns the resolved absolute path. Throws PermissionDenied otherwise.
   */
  checkFile(path: string): string {
    if (!this.#files) {
      throw new PermissionDenied("The customer has not granted file access.");
    }
    const target = isAbsolute(path)
      ? resolve(path)
      : resolve(this.#projectDir, path);
    if (target !== this.#projectDir && !target.startsWith(this.#projectDir + sep)) {
      throw new PermissionDenied(
        `Path is outside the approved project directory (${this.#projectDir}).`,
      );
    }
    return target;
  }

  /** Validate that terminal commands are allowed. */
  checkTerminal(): void {
    if (!this.#terminal) {
      throw new PermissionDenied(
        "The customer has not granted terminal access.",
      );
    }
  }

  /**
   * Validate a browser port against the browser scope. Returns the port to use.
   * Throws PermissionDenied if browser is not granted or the port differs.
   */
  checkBrowser(port?: number): number {
    if (!this.#browser || this.#browserPort === undefined) {
      throw new PermissionDenied("The customer has not granted browser access.");
    }
    const requested = port ?? this.#browserPort;
    if (requested !== this.#browserPort) {
      throw new PermissionDenied(
        `Browser access is scoped to localhost:${this.#browserPort}, not localhost:${requested}.`,
      );
    }
    return this.#browserPort;
  }
}
