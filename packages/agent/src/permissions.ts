import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";

/**
 * Basename/path patterns that are always private, regardless of what the
 * project's own .gitignore says. These cover the files a customer would
 * never expect a remote expert to open, even on a project with no
 * .gitignore at all.
 */
const SECRET_DENYLIST = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  // Both the bare directory and its contents: the bare form keeps the .aws /
  // .ssh entries themselves out of directory listings, not just their children.
  ".aws",
  ".aws/",
  ".ssh",
  ".ssh/",
  // Any basename starting with "credentials" (credentials.json,
  // credentials-prod.json, credentials-production.json, ...).
  "credentials*",
];

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
  readonly #secretIgnore = ignore().add(SECRET_DENYLIST);
  #gitignore?: ReturnType<typeof ignore>;

  constructor(projectDir: string) {
    const resolved = resolve(projectDir);
    // Resolve the project root through any symlinks up front so containment
    // compares real path against real path. If the directory does not exist
    // yet (e.g. in unit tests using a synthetic path), fall back to the
    // lexical resolve so behavior is unchanged.
    try {
      this.#projectDir = realpathSync(resolved);
    } catch {
      this.#projectDir = resolved;
    }
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
    const lexical = isAbsolute(path)
      ? resolve(path)
      : resolve(this.#projectDir, path);
    // Resolve symlinks BEFORE the containment and private-file checks. A
    // lexical resolve alone would let a pre-existing symlink with an innocent
    // name (public.md -> .env, or -> /etc/passwd) slip past both checks and
    // then have the read follow the link straight to the secret.
    const target = this.#realPath(lexical);
    if (target !== this.#projectDir && !target.startsWith(this.#projectDir + sep)) {
      throw new PermissionDenied(
        `Path is outside the approved project directory (${this.#projectDir}).`,
      );
    }
    if (this.isPrivate(target)) {
      throw new PermissionDenied(
        "This file is private and is not shared with the expert.",
      );
    }
    return target;
  }

  /**
   * Resolve `lexical` (an already absolute path) through any symlinks so the
   * containment and private-file checks run on the REAL location on disk.
   *
   *  - Existing path: follow it to its real target.
   *  - Not-yet-existing path (a write to a new file): resolve the real PARENT
   *    directory and rejoin the basename, so a symlinked parent cannot smuggle
   *    the path out of the project while a brand-new leaf name still resolves.
   *  - Broken link or missing parent: fall back to the lexical path so
   *    containment still runs, and a genuine read just hits the normal
   *    not-found behavior instead of crashing.
   */
  #realPath(lexical: string): string {
    try {
      return realpathSync(lexical);
    } catch {
      try {
        return join(realpathSync(dirname(lexical)), basename(lexical));
      } catch {
        return lexical;
      }
    }
  }

  /**
   * True if `path` (an absolute path inside the project) is off-limits to the
   * expert: matched by the project's .gitignore, or on the hardcoded secret
   * denylist that applies regardless of .gitignore. Used by checkFile and by
   * directory listings so private entries never even show up.
   */
  isPrivate(path: string): boolean {
    const rel = relative(this.#projectDir, resolve(path));
    if (rel === "" || rel.startsWith("..")) return false;
    const posixRel = rel.split(sep).join("/");
    return this.#secretIgnore.ignores(posixRel) || this.#loadGitignore().ignores(posixRel);
  }

  /** Load the project's root .gitignore once, on first use. Missing file means no extra rules. */
  #loadGitignore(): ReturnType<typeof ignore> {
    if (!this.#gitignore) {
      this.#gitignore = ignore();
      try {
        const contents = readFileSync(join(this.#projectDir, ".gitignore"), "utf8");
        this.#gitignore.add(contents);
      } catch {
        // No .gitignore in this project: nothing beyond the secret denylist.
      }
    }
    return this.#gitignore;
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
