import { describe, expect, it } from "vitest";
import { checkBrowser, checkNativeModules, checkNodeVersion, runDoctor } from "./doctor";

describe("checkNodeVersion", () => {
  it("passes for Node 18 and newer", () => {
    expect(checkNodeVersion("18.0.0")).toBeUndefined();
    expect(checkNodeVersion("20.11.1")).toBeUndefined();
  });

  it("fails with the specific message for Node below 18", () => {
    const issue = checkNodeVersion("16.14.2");
    expect(issue?.message).toBe(
      "Get An Expert needs Node 18 or newer. You have 16.14.2. Update Node and run it again.",
    );
  });
});

describe("checkNativeModules", () => {
  it("returns no issues when every module loads", () => {
    expect(checkNativeModules(() => {})).toEqual([]);
  });

  it("names the module that cannot load", () => {
    const issues = checkNativeModules((name) => {
      if (name === "node-pty") throw new Error("boom");
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("node-pty");
  });

  it("reports every module that fails to load, not just the first", () => {
    const issues = checkNativeModules(() => {
      throw new Error("boom");
    });
    const combined = issues.map((issue) => issue.message).join(" ");
    expect(combined).toContain("node-datachannel");
    expect(combined).toContain("node-pty");
  });
});

describe("checkBrowser", () => {
  it("is informational (non-fatal) when no browser is found", () => {
    const issue = checkBrowser(() => false);
    expect(issue).toBeDefined();
    expect(issue?.message).toBeTruthy();
  });

  it("returns nothing when a browser is present", () => {
    expect(checkBrowser(() => true)).toBeUndefined();
  });
});

describe("runDoctor", () => {
  it("is ok when Node and native modules are fine, missing browser is informational", () => {
    const result = runDoctor({
      nodeVersion: "20.0.0",
      loadNativeModule: () => {},
      hasBrowser: () => false,
    });
    expect(result.ok).toBe(true);
    expect(result.fatal).toEqual([]);
    expect(result.info).toHaveLength(1);
  });

  it("is not ok when Node is too old", () => {
    const result = runDoctor({
      nodeVersion: "14.0.0",
      loadNativeModule: () => {},
      hasBrowser: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.fatal).toHaveLength(1);
    expect(result.info).toEqual([]);
  });

  it("is not ok when a native module fails to load", () => {
    const result = runDoctor({
      nodeVersion: "20.0.0",
      loadNativeModule: () => {
        throw new Error("boom");
      },
      hasBrowser: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
  });
});
