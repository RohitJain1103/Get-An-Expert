import { describe, expect, it } from "vitest";
import { PermissionGate } from "./permissions";
import { SessionLog } from "./session";

describe("SessionLog", () => {
  it("collects activity entries in order", () => {
    const log = new SessionLog();
    log.record({ at: 1, kind: "read_file", summary: "Expert reading: a.ts" });
    log.record({ at: 2, kind: "write_file", summary: "Expert edited: a.ts" });
    expect(log.entries()).toHaveLength(2);
    expect(log.entries()[0].kind).toBe("read_file");
  });

  it("returns immutable snapshots of the log", () => {
    const log = new SessionLog();
    log.record({ at: 1, kind: "read_file", summary: "x" });
    const snap = log.entries();
    log.record({ at: 2, kind: "write_file", summary: "y" });
    expect(snap).toHaveLength(1);
  });

  it("caps entries at the configured limit", () => {
    const log = new SessionLog({ cap: 3 });
    for (let i = 0; i < 5; i++) {
      log.record({ at: i, kind: "run_command", summary: `cmd ${i}` });
    }
    expect(log.entries()).toHaveLength(3);
    expect(log.entries()[0].summary).toBe("cmd 2");
  });
});

describe("SessionLog.summary", () => {
  it("derives files modified and commands run from the log", () => {
    const gate = new PermissionGate("/home/jordan/projects/landing-page");
    gate.grant({ files: true, terminal: true, browser: false });
    const log = new SessionLog();
    log.record({ at: 1, kind: "read_file", summary: "Expert reading: src/Hero.tsx" });
    log.record({ at: 2, kind: "write_file", summary: "Expert edited: src/Hero.tsx" });
    log.record({ at: 3, kind: "write_file", summary: "Expert edited: src/index.tsx" });
    log.record({ at: 4, kind: "run_command", summary: "Expert ran: npm run dev" });

    const summary = log.summary({
      expertName: "Priya Sharma",
      startedAt: 0,
      endedAt: 4000,
      permissions: gate.snapshot(),
    });

    expect(summary.expertName).toBe("Priya Sharma");
    expect(summary.durationMs).toBe(4000);
    expect(summary.filesModified).toEqual(["src/Hero.tsx", "src/index.tsx"]);
    expect(summary.commandsRun).toEqual(["npm run dev"]);
    expect(summary.activityCount).toBe(4);
    expect(summary.finalPermissions.files).toBe(true);
  });

  it("dedupes repeated file edits", () => {
    const log = new SessionLog();
    log.record({ at: 1, kind: "write_file", summary: "Expert edited: a.ts" });
    log.record({ at: 2, kind: "write_file", summary: "Expert edited: a.ts" });
    const summary = log.summary({
      startedAt: 0,
      endedAt: 1000,
      permissions: { files: true, terminal: false, browser: false },
    });
    expect(summary.filesModified).toEqual(["a.ts"]);
  });
});
