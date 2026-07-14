import type { RelayEventType } from "@get-an-expert/core";

/** A host hook payload distilled to what the expert needs to see. */
export interface RelayEvent {
  type: RelayEventType;
  text: string;
}

/** Local cap; the API's schema cap (32k) is the abuse backstop. */
export const MAX_EVENT_TEXT = 16_000;

const HEAD_KEEP = 12_000;
const TAIL_KEEP = 3_000;

/** Middle-out truncation: long output's start and end carry the signal. */
export function truncate(text: string): string {
  if (text.length <= MAX_EVENT_TEXT) return text;
  const dropped = text.length - HEAD_KEEP - TAIL_KEEP;
  return (
    text.slice(0, HEAD_KEEP) +
    `\n… [truncated ${dropped} chars] …\n` +
    text.slice(text.length - TAIL_KEEP)
  );
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

type Dict = Record<string, unknown>;
const dict = (value: unknown): Dict =>
  typeof value === "object" && value !== null ? (value as Dict) : {};

function editsText(filePath: string, edits: unknown): string {
  const lines = [filePath];
  if (Array.isArray(edits)) {
    for (const edit of edits.slice(0, 10)) {
      const e = dict(edit);
      if (typeof e.old_string === "string") lines.push(`- ${e.old_string}`);
      if (typeof e.new_string === "string") lines.push(`+ ${e.new_string}`);
    }
  }
  return lines.join("\n");
}

/** Best-effort stringify of Claude Code's tool_response for Bash. */
function toolResponseText(response: unknown): string {
  if (typeof response === "string") return response;
  const r = dict(response);
  const parts: string[] = [];
  if (typeof r.stdout === "string" && r.stdout) parts.push(r.stdout);
  if (typeof r.stderr === "string" && r.stderr) parts.push(r.stderr);
  if (parts.length > 0) return parts.join("\n");
  try {
    return JSON.stringify(response ?? "");
  } catch {
    return "";
  }
}

const CLAUDE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Claude Code hook payloads (via the plugin's relay-hook bridge).
 * events: "prompt" (UserPromptSubmit), "tool" (PostToolUse), "agent-reply"
 * (Stop — the bridge caller extracts the transcript text into {text}).
 */
export function normalizeClaudeCode(
  event: string,
  payload: unknown,
): RelayEvent | null {
  const p = dict(payload);
  if (event === "prompt") {
    const prompt = str(p.prompt);
    return prompt ? { type: "prompt", text: prompt } : null;
  }
  if (event === "tool") {
    const toolName = str(p.tool_name);
    const input = dict(p.tool_input);
    if (toolName === "Bash") {
      const command = str(input.command);
      if (!command) return null;
      const output = toolResponseText(p.tool_response);
      return { type: "command", text: `$ ${command}\n${output}`.trimEnd() };
    }
    if (toolName && CLAUDE_EDIT_TOOLS.has(toolName)) {
      const filePath = str(input.file_path) ?? str(input.notebook_path);
      if (!filePath) return null;
      if (typeof input.old_string === "string" || Array.isArray(input.edits)) {
        const edits = Array.isArray(input.edits)
          ? input.edits
          : [{ old_string: input.old_string, new_string: input.new_string }];
        return { type: "edit", text: editsText(filePath, edits) };
      }
      if (typeof input.content === "string" || typeof input.new_source === "string") {
        const content = str(input.content) ?? str(input.new_source) ?? "";
        return { type: "edit", text: `${filePath}\n${content}` };
      }
      return { type: "edit", text: filePath };
    }
    return null;
  }
  if (event === "agent-reply") {
    const text = str(p.text);
    return text ? { type: "agent_reply", text } : null;
  }
  return null;
}

/** Cursor hooks (~/.cursor/hooks.json), event names as documented. */
export function normalizeCursor(
  event: string,
  payload: unknown,
): RelayEvent | null {
  const p = dict(payload);
  if (event === "beforeSubmitPrompt") {
    const prompt = str(p.prompt);
    return prompt ? { type: "prompt", text: prompt } : null;
  }
  if (event === "afterShellExecution") {
    const command = str(p.command);
    if (!command) return null;
    const output = str(p.output) ?? "";
    return { type: "command", text: `$ ${command}\n${output}`.trimEnd() };
  }
  if (event === "afterFileEdit") {
    const filePath = str(p.file_path);
    return filePath
      ? { type: "edit", text: editsText(filePath, p.edits) }
      : null;
  }
  if (event === "afterAgentResponse") {
    const text = str(p.text);
    return text ? { type: "agent_reply", text } : null;
  }
  return null;
}

/**
 * Windsurf Cascade hooks (~/.codeium/windsurf/hooks.json). Payload nests
 * under tool_info. Windsurf's post_run_command does NOT include command
 * output — the expert sees the command line only (documented limitation).
 */
export function normalizeWindsurf(
  event: string,
  payload: unknown,
): RelayEvent | null {
  const info = dict(dict(payload).tool_info);
  if (event === "pre_user_prompt") {
    const prompt = str(info.user_prompt);
    return prompt ? { type: "prompt", text: prompt } : null;
  }
  if (event === "post_run_command") {
    const command = str(info.command_line);
    if (!command) return null;
    return {
      type: "command",
      text: `$ ${command}\n[output not provided by Windsurf hooks]`,
    };
  }
  if (event === "post_write_code") {
    const filePath = str(info.file_path);
    return filePath
      ? { type: "edit", text: editsText(filePath, info.edits) }
      : null;
  }
  if (event === "post_cascade_response") {
    const response = str(info.response);
    return response ? { type: "agent_reply", text: response } : null;
  }
  return null;
}
