import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDenied, PermissionGate } from "./permissions";
import { AgentTools } from "./tools";
import type { ActivityEntry, BrowserController } from "./types";

let projectDir: string;
let gate: PermissionGate;
let activity: ActivityEntry[];
let browser: BrowserController;
let tools: AgentTools;

const fakeBrowser: BrowserController = {
  async screenshot(port) {
    return { ok: true, port, status: 200, title: "Gradient Hero", note: "captured" };
  },
  async console(port) {
    return { port, entries: [{ level: "info", text: "compiled ok" }] };
  },
};

beforeEach(() => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-proj-")));
  mkdirSync(join(projectDir, "src", "components"), { recursive: true });
  writeFileSync(
    join(projectDir, "src", "components", "Hero.tsx"),
    "import { HeroImage } from '@/assets';\n",
  );
  writeFileSync(join(projectDir, "package.json"), '{"name":"landing-page"}\n');
  gate = new PermissionGate(projectDir);
  activity = [];
  browser = fakeBrowser;
  tools = new AgentTools({
    gate,
    browser,
    onActivity: (e) => activity.push(e),
  });
});

function grantAll() {
  gate.grant({ files: true, terminal: true, browser: true, browserPort: 3000 });
}

describe("list_files", () => {
  it("lists the project tree when files granted", async () => {
    grantAll();
    const res = await tools.listFiles(".");
    const names = res.entries.map((e) => e.path);
    expect(names).toContain("package.json");
    expect(names).toContain("src/components/Hero.tsx");
  });

  it("throws PermissionDenied without files scope", async () => {
    await expect(tools.listFiles(".")).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("logs a list activity", async () => {
    grantAll();
    await tools.listFiles(".");
    expect(activity.some((a) => a.kind === "list_files")).toBe(true);
  });
});

describe("read_file", () => {
  it("reads a file inside the project", async () => {
    grantAll();
    const res = await tools.readFile("src/components/Hero.tsx");
    expect(res.content).toContain("HeroImage");
    expect(activity.at(-1)?.kind).toBe("read_file");
    expect(activity.at(-1)?.summary).toContain("Hero.tsx");
  });

  it("refuses a path outside the project", async () => {
    grantAll();
    await expect(tools.readFile("../../etc/passwd")).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe("write_file", () => {
  it("writes a file inside the project and logs it", async () => {
    grantAll();
    await tools.writeFile(
      "src/components/Hero.tsx",
      "import { HeroImg } from '@/assets';\n",
    );
    const written = readFileSync(join(projectDir, "src/components/Hero.tsx"), "utf8");
    expect(written).toContain("HeroImg");
    expect(activity.at(-1)?.kind).toBe("write_file");
  });

  it("refuses to write outside the project", async () => {
    grantAll();
    await expect(
      tools.writeFile("../escape.txt", "nope"),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("creates parent directories as needed", async () => {
    grantAll();
    await tools.writeFile("src/new/deep/file.ts", "export const x = 1;\n");
    expect(readFileSync(join(projectDir, "src/new/deep/file.ts"), "utf8")).toContain(
      "export const x",
    );
  });
});

describe("run_command", () => {
  it("runs a command in the project directory", async () => {
    grantAll();
    const res = await tools.runCommand("cat package.json");
    expect(res.stdout).toContain("landing-page");
    expect(res.exitCode).toBe(0);
    expect(activity.at(-1)?.kind).toBe("run_command");
  });

  it("captures non-zero exit codes and stderr", async () => {
    grantAll();
    const res = await tools.runCommand("ls /no/such/path/here");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);
  });

  it("throws PermissionDenied without terminal scope", async () => {
    gate.grant({ files: true, terminal: false, browser: false });
    await expect(tools.runCommand("echo hi")).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("kills commands that exceed the timeout", async () => {
    grantAll();
    const res = await tools.runCommand("sleep 5", { timeoutMs: 200 });
    expect(res.timedOut).toBe(true);
  });
});

describe("browser tools", () => {
  it("captures a screenshot on the granted port", async () => {
    grantAll();
    const res = await tools.browserScreenshot(3000);
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Gradient Hero");
    expect(activity.at(-1)?.kind).toBe("browser_screenshot");
  });

  it("reads the console on the granted port", async () => {
    grantAll();
    const res = await tools.browserConsole(3000);
    expect(res.entries[0].text).toBe("compiled ok");
  });

  it("refuses a non-granted port", async () => {
    grantAll();
    await expect(tools.browserScreenshot(8080)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("throws PermissionDenied without browser scope", async () => {
    gate.grant({ files: true, terminal: true, browser: false });
    await expect(tools.browserScreenshot()).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe("activity log integrity", () => {
  it("does not include file contents in the activity summary", async () => {
    grantAll();
    await tools.readFile("src/components/Hero.tsx");
    const entry = activity.at(-1)!;
    expect(entry.summary).not.toContain("HeroImage");
  });
});
