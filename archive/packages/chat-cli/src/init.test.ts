import { describe, expect, it } from "vitest";
import { mergeCursorHooks, mergeWindsurfHooks } from "./init";

const RELAY = "/home/u/.get-an-expert/relay.mjs";

describe("mergeCursorHooks", () => {
  it("builds a fresh config with all four observe events", () => {
    const config = mergeCursorHooks(null, RELAY) as {
      version: number;
      hooks: Record<string, { command: string }[]>;
    };
    expect(config.version).toBe(1);
    for (const event of [
      "beforeSubmitPrompt",
      "afterShellExecution",
      "afterFileEdit",
      "afterAgentResponse",
    ]) {
      expect(config.hooks[event]).toHaveLength(1);
      expect(config.hooks[event][0].command).toBe(
        `node "${RELAY}" cursor ${event}`,
      );
    }
  });

  it("preserves existing user hooks and appends ours", () => {
    const existing = {
      version: 1,
      hooks: {
        beforeSubmitPrompt: [{ command: "./mine.sh" }],
        beforeShellExecution: [{ command: "./guard.sh" }],
      },
    };
    const config = mergeCursorHooks(existing, RELAY) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(config.hooks.beforeSubmitPrompt.map((h) => h.command)).toEqual([
      "./mine.sh",
      `node "${RELAY}" cursor beforeSubmitPrompt`,
    ]);
    expect(config.hooks.beforeShellExecution).toEqual([
      { command: "./guard.sh" },
    ]);
  });

  it("is idempotent — double init adds nothing", () => {
    const once = mergeCursorHooks(null, RELAY);
    const twice = mergeCursorHooks(once, RELAY) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(twice.hooks.afterShellExecution).toHaveLength(1);
  });
});

describe("mergeWindsurfHooks", () => {
  it("builds a fresh config with the four Cascade events", () => {
    const config = mergeWindsurfHooks(null, RELAY) as {
      hooks: Record<string, { command: string }[]>;
    };
    for (const event of [
      "pre_user_prompt",
      "post_run_command",
      "post_write_code",
      "post_cascade_response",
    ]) {
      expect(config.hooks[event]).toHaveLength(1);
      expect(config.hooks[event][0].command).toBe(
        `node "${RELAY}" windsurf ${event}`,
      );
    }
  });

  it("preserves existing hooks and is idempotent", () => {
    const existing = {
      hooks: { pre_user_prompt: [{ command: "echo mine" }] },
    };
    const once = mergeWindsurfHooks(existing, RELAY);
    const twice = mergeWindsurfHooks(once, RELAY) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(twice.hooks.pre_user_prompt.map((h) => h.command)).toEqual([
      "echo mine",
      `node "${RELAY}" windsurf pre_user_prompt`,
    ]);
  });
});
