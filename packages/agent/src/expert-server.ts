import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PermissionDenied } from "./permissions";
import type { AgentTools } from "./tools";

const SERVER_NAME = "get-an-expert-agent";
const SERVER_VERSION = "0.1.0";

const EXPERT_INSTRUCTIONS = `You are connected to the customer's machine through Get An Expert. Every tool here runs on THEIR machine, in THEIR project directory, and only within the scopes the customer approved (files, terminal, browser). The customer sees a live log of every action. Read before you edit, run commands to reproduce and verify, and check the browser to confirm the fix renders. If a tool returns a permission error, the customer has not granted or has revoked that scope — ask them, don't work around it.`;

function ok(data: unknown) {
  // Compact, not pretty-printed: these frames cross a size-limited WebRTC data
  // channel, and the two-space indentation just inflates every reply for a
  // machine reader that parses it with JSON.parse anyway.
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

async function guard<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof PermissionDenied) return fail(`Permission denied: ${err.message}`);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build the MCP server the expert's dashboard talks to over the WebRTC data
 * channel. Its tools are the design's agent surface — list_files, read_file,
 * write_file, run_command, browser_screenshot, browser_console — each backed
 * by the permission-gated AgentTools on the customer's machine.
 */
export function createExpertServer(tools: AgentTools): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: EXPERT_INSTRUCTIONS },
  );

  server.registerTool(
    "list_files",
    {
      description:
        "List files in the customer's project directory. Recursive by default; pass depth to limit descent (depth 1 = immediate children only). Requires the Files scope.",
      inputSchema: {
        dir: z
          .string()
          .optional()
          .describe("Directory relative to the project root. Defaults to the root."),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many directory levels to descend. Omit for the full recursive tree; pass 1 for immediate children only.",
          ),
      },
    },
    async ({ dir, depth }) =>
      guard(() => tools.listFiles(dir ?? ".", depth ? { depth } : {})),
  );

  server.registerTool(
    "read_file",
    {
      description:
        "Read a file inside the customer's project directory. Requires the Files scope.",
      inputSchema: {
        path: z.string().describe("File path, relative to the project root or absolute inside it."),
      },
    },
    async ({ path }) => guard(() => tools.readFile(path)),
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Write (create or overwrite) a file inside the customer's project directory. Requires the Files scope.",
      inputSchema: {
        path: z.string().describe("File path, relative to the project root or absolute inside it."),
        content: z.string().describe("Full new file contents."),
      },
    },
    async ({ path, content }) => guard(() => tools.writeFile(path, content)),
  );

  server.registerTool(
    "run_command",
    {
      description:
        "Run a shell command in the customer's project directory. Requires the Terminal scope. You may run `claude`, `codex`, or any tool installed on the customer's machine.",
      inputSchema: {
        command: z.string().describe("The command line to run."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Kill the command after this many milliseconds."),
      },
    },
    async ({ command, timeoutMs }) =>
      guard(() => tools.runCommand(command, timeoutMs ? { timeoutMs } : {})),
  );

  server.registerTool(
    "browser_screenshot",
    {
      description:
        "Check/capture the rendered page at the customer's approved localhost port. Requires the Browser scope.",
      inputSchema: {
        port: z.number().int().positive().optional().describe("Localhost port. Defaults to the approved port."),
      },
    },
    async ({ port }) => guard(() => tools.browserScreenshot(port)),
  );

  server.registerTool(
    "browser_console",
    {
      description:
        "Read console/status for the page at the customer's approved localhost port. Requires the Browser scope.",
      inputSchema: {
        port: z.number().int().positive().optional().describe("Localhost port. Defaults to the approved port."),
      },
    },
    async ({ port }) => guard(() => tools.browserConsole(port)),
  );

  return server;
}
