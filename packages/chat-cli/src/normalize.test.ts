import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_TEXT,
  normalizeClaudeCode,
  normalizeCursor,
  normalizeWindsurf,
  truncate,
} from "./normalize";

describe("truncate", () => {
  it("passes short text through untouched", () => {
    expect(truncate("hello")).toBe("hello");
  });
  it("caps long text with a marker, keeping head and tail", () => {
    const long = `HEAD${"x".repeat(40_000)}TAIL`;
    const out = truncate(long);
    expect(out.length).toBeLessThanOrEqual(MAX_EVENT_TEXT);
    expect(out.startsWith("HEAD")).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).toContain("[truncated");
  });
});

describe("normalizeClaudeCode", () => {
  it("maps prompt", () => {
    expect(normalizeClaudeCode("prompt", { prompt: "fix my build" })).toEqual({
      type: "prompt",
      text: "fix my build",
    });
  });

  it("maps Bash tool use to a command event with output", () => {
    const result = normalizeClaudeCode("tool", {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "1 failed", stderr: "boom" },
    });
    expect(result?.type).toBe("command");
    expect(result?.text).toContain("$ pnpm test");
    expect(result?.text).toContain("1 failed");
    expect(result?.text).toContain("boom");
  });

  it("maps Edit tool use to an edit event", () => {
    const result = normalizeClaudeCode("tool", {
      tool_name: "Edit",
      tool_input: {
        file_path: "/x/y.ts",
        old_string: "const a = 1",
        new_string: "const a = 2",
      },
    });
    expect(result?.type).toBe("edit");
    expect(result?.text).toContain("/x/y.ts");
    expect(result?.text).toContain("- const a = 1");
    expect(result?.text).toContain("+ const a = 2");
  });

  it("maps Write tool use to an edit event with content head", () => {
    const result = normalizeClaudeCode("tool", {
      tool_name: "Write",
      tool_input: { file_path: "/x/new.ts", content: "hello world" },
    });
    expect(result?.type).toBe("edit");
    expect(result?.text).toContain("/x/new.ts");
    expect(result?.text).toContain("hello world");
  });

  it("ignores read-only tools", () => {
    expect(
      normalizeClaudeCode("tool", {
        tool_name: "Read",
        tool_input: { file_path: "/x" },
      }),
    ).toBeNull();
  });

  it("maps agent-reply text", () => {
    expect(
      normalizeClaudeCode("agent-reply", { text: "I fixed it by…" }),
    ).toEqual({ type: "agent_reply", text: "I fixed it by…" });
  });

  it("is null-safe on malformed payloads", () => {
    expect(normalizeClaudeCode("prompt", {})).toBeNull();
    expect(normalizeClaudeCode("tool", { tool_name: "Bash" })).toBeNull();
    expect(normalizeClaudeCode("nope", { prompt: "x" })).toBeNull();
    expect(normalizeClaudeCode("prompt", null)).toBeNull();
  });
});

describe("normalizeCursor", () => {
  it("maps beforeSubmitPrompt", () => {
    expect(normalizeCursor("beforeSubmitPrompt", { prompt: "hi" })).toEqual({
      type: "prompt",
      text: "hi",
    });
  });
  it("maps afterShellExecution with full output", () => {
    const result = normalizeCursor("afterShellExecution", {
      command: "npm test",
      output: "8 passing",
      duration: 1234,
    });
    expect(result?.type).toBe("command");
    expect(result?.text).toBe("$ npm test\n8 passing");
  });
  it("maps afterFileEdit with edits", () => {
    const result = normalizeCursor("afterFileEdit", {
      file_path: "/a/b.ts",
      edits: [{ old_string: "foo", new_string: "bar" }],
    });
    expect(result?.type).toBe("edit");
    expect(result?.text).toContain("/a/b.ts");
    expect(result?.text).toContain("- foo");
    expect(result?.text).toContain("+ bar");
  });
  it("maps afterAgentResponse", () => {
    expect(normalizeCursor("afterAgentResponse", { text: "done" })).toEqual({
      type: "agent_reply",
      text: "done",
    });
  });
  it("is null-safe", () => {
    expect(normalizeCursor("afterShellExecution", {})).toBeNull();
    expect(normalizeCursor("sessionEnd", { reason: "done" })).toBeNull();
  });
});

describe("normalizeWindsurf", () => {
  it("maps pre_user_prompt", () => {
    expect(
      normalizeWindsurf("pre_user_prompt", {
        agent_action_name: "pre_user_prompt",
        tool_info: { user_prompt: "help" },
      }),
    ).toEqual({ type: "prompt", text: "help" });
  });
  it("maps post_run_command, noting the missing output", () => {
    const result = normalizeWindsurf("post_run_command", {
      tool_info: { command_line: "go test ./...", cwd: "/w" },
    });
    expect(result?.type).toBe("command");
    expect(result?.text).toContain("$ go test ./...");
    expect(result?.text).toContain("output not provided by Windsurf hooks");
  });
  it("maps post_write_code", () => {
    const result = normalizeWindsurf("post_write_code", {
      tool_info: {
        file_path: "/a.py",
        edits: [{ old_string: "x=1", new_string: "x=2" }],
      },
    });
    expect(result?.type).toBe("edit");
    expect(result?.text).toContain("/a.py");
  });
  it("maps post_cascade_response", () => {
    expect(
      normalizeWindsurf("post_cascade_response", {
        tool_info: { response: "all set" },
      }),
    ).toEqual({ type: "agent_reply", text: "all set" });
  });
  it("is null-safe", () => {
    expect(normalizeWindsurf("post_run_command", {})).toBeNull();
    expect(normalizeWindsurf("pre_read_code", { tool_info: {} })).toBeNull();
  });
});
