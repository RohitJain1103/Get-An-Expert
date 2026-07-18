import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PermissionDenied, PermissionGate } from "./permissions";

const PROJECT = "/home/jordan/projects/landing-page";

function gate() {
  return new PermissionGate(PROJECT);
}

describe("PermissionGate defaults", () => {
  it("starts with nothing granted", () => {
    const g = gate();
    expect(g.snapshot()).toEqual({
      files: false,
      terminal: false,
      browser: false,
    });
  });

  it("denies file access before files is granted", () => {
    const g = gate();
    expect(() => g.checkFile(`${PROJECT}/src/index.ts`)).toThrow(PermissionDenied);
  });

  it("denies commands before terminal is granted", () => {
    const g = gate();
    expect(() => g.checkTerminal()).toThrow(PermissionDenied);
  });

  it("denies browser before browser is granted", () => {
    const g = gate();
    expect(() => g.checkBrowser(3000)).toThrow(PermissionDenied);
  });
});

describe("PermissionGate.grant / revoke", () => {
  it("grants and revokes the files scope", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(g.snapshot().files).toBe(true);
    g.revoke("files");
    expect(g.snapshot().files).toBe(false);
    expect(() => g.checkFile(`${PROJECT}/a.ts`)).toThrow(PermissionDenied);
  });

  it("records the browser port when browser is granted", () => {
    const g = gate();
    g.grant({ files: false, terminal: false, browser: true, browserPort: 3000 });
    expect(g.snapshot().browserPort).toBe(3000);
  });
});

describe("PermissionGate.checkFile path containment", () => {
  it("allows files inside the project directory", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(g.checkFile(`${PROJECT}/src/components/Hero.tsx`)).toBe(
      `${PROJECT}/src/components/Hero.tsx`,
    );
  });

  it("allows the project directory itself", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(g.checkFile(PROJECT)).toBe(PROJECT);
  });

  it("resolves relative paths against the project directory", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(g.checkFile("src/index.ts")).toBe(`${PROJECT}/src/index.ts`);
  });

  it("rejects paths that escape the project directory via ..", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(() => g.checkFile(`${PROJECT}/../other/secret.txt`)).toThrow(
      PermissionDenied,
    );
  });

  it("rejects absolute paths outside the project", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(() => g.checkFile("/etc/passwd")).toThrow(PermissionDenied);
    expect(() => g.checkFile("/home/jordan/.ssh/id_rsa")).toThrow(PermissionDenied);
  });

  it("rejects a sibling directory sharing a name prefix", () => {
    const g = gate();
    g.grant({ files: true, terminal: false, browser: false });
    expect(() => g.checkFile("/home/jordan/projects/landing-page-secrets/x")).toThrow(
      PermissionDenied,
    );
  });
});

describe("PermissionGate.checkBrowser port scoping", () => {
  it("allows only the granted port", () => {
    const g = gate();
    g.grant({ files: false, terminal: false, browser: true, browserPort: 3000 });
    expect(g.checkBrowser(3000)).toBe(3000);
  });

  it("rejects a different port than the one granted", () => {
    const g = gate();
    g.grant({ files: false, terminal: false, browser: true, browserPort: 3000 });
    expect(() => g.checkBrowser(8080)).toThrow(PermissionDenied);
  });

  it("defaults to the granted port when none is requested", () => {
    const g = gate();
    g.grant({ files: false, terminal: false, browser: true, browserPort: 5173 });
    expect(g.checkBrowser()).toBe(5173);
  });
});

describe("PermissionGate.revokeAll", () => {
  it("clears every scope", () => {
    const g = gate();
    g.grant({ files: true, terminal: true, browser: true, browserPort: 3000 });
    g.revokeAll();
    expect(g.snapshot()).toEqual({ files: false, terminal: false, browser: false });
  });
});

describe("PermissionGate.checkFile private files (.gitignore + secret denylist)", () => {
  function realProjectGate(dir: string) {
    const g = new PermissionGate(dir);
    g.grant({ files: true, terminal: false, browser: false });
    return g;
  }

  it("blocks .env even with no .gitignore present", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gae-perm-")));
    writeFileSync(join(dir, "index.ts"), "export {};\n");
    const g = realProjectGate(dir);
    expect(() => g.checkFile(join(dir, ".env"))).toThrow(PermissionDenied);
  });

  it("still allows a normal file when no .gitignore is present", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gae-perm-")));
    writeFileSync(join(dir, "index.ts"), "export {};\n");
    const g = realProjectGate(dir);
    expect(g.checkFile(join(dir, "index.ts"))).toBe(join(dir, "index.ts"));
  });

  it("blocks a path matched by the project's .gitignore", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gae-perm-")));
    writeFileSync(join(dir, ".gitignore"), "dist/\n");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "secret.js"), "// built\n");
    const g = realProjectGate(dir);
    expect(() => g.checkFile(join(dir, "dist", "secret.js"))).toThrow(PermissionDenied);
  });

  it("allows a normal source file alongside an active .gitignore", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gae-perm-")));
    writeFileSync(join(dir, ".gitignore"), "dist/\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
    const g = realProjectGate(dir);
    expect(g.checkFile(join(dir, "src", "index.ts"))).toBe(join(dir, "src", "index.ts"));
  });

  it("does not leak the denylist in the error message", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gae-perm-")));
    const g = realProjectGate(dir);
    try {
      g.checkFile(join(dir, ".env"));
      throw new Error("expected checkFile to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionDenied);
      expect((err as Error).message).not.toContain("id_rsa");
      expect((err as Error).message).not.toContain(".pem");
    }
  });
});
