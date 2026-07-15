import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExpertServer } from "./expert-server";
import { PermissionGate } from "./permissions";
import { AgentTools } from "./tools";
import { createLoopbackPair } from "./webrtc/channel";
import { DataChannelTransport } from "./webrtc/transport";
import type { ActivityEntry, BrowserController } from "./types";

const fakeBrowser: BrowserController = {
  async screenshot(port) {
    return { ok: true, port, status: 200, title: "Gradient Hero", note: "captured" };
  },
  async console(port) {
    return { port, entries: [{ level: "info", text: "compiled ok" }] };
  },
};

let projectDir: string;
let gate: PermissionGate;
let activity: ActivityEntry[];
let client: Client;
let cleanup: (() => Promise<void>)[];

async function connectClientAndServer() {
  const tools = new AgentTools({
    gate,
    browser: fakeBrowser,
    onActivity: (e) => activity.push(e),
  });
  const server = createExpertServer(tools);
  const [expertChannel, agentChannel] = createLoopbackPair();
  const serverTransport = new DataChannelTransport(agentChannel);
  const clientTransport = new DataChannelTransport(expertChannel);

  await server.connect(serverTransport);
  const c = new Client({ name: "get-an-expert-dashboard-test", version: "0.0.0" });
  await c.connect(clientTransport);
  cleanup.push(async () => {
    await c.close();
    await server.close();
  });
  return c;
}

beforeEach(async () => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-exp-")));
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src", "Hero.tsx"), "import { HeroImage } from '@/assets';\n");
  writeFileSync(join(projectDir, "package.json"), '{"name":"lp"}\n');
  gate = new PermissionGate(projectDir);
  gate.grant({ files: true, terminal: true, browser: true, browserPort: 3000 });
  activity = [];
  cleanup = [];
  client = await connectClientAndServer();
});

afterEach(async () => {
  for (const fn of cleanup) await fn();
});

describe("expert MCP server over a data channel", () => {
  it("lists the six agent tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "browser_console",
      "browser_screenshot",
      "list_files",
      "read_file",
      "run_command",
      "write_file",
    ]);
  });

  it("reads a file through the channel", async () => {
    const res: any = await client.callTool({
      name: "read_file",
      arguments: { path: "src/Hero.tsx" },
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.content).toContain("HeroImage");
  });

  it("writes a file through the channel", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "src/Hero.tsx", content: "import { HeroImg } from '@/assets';\n" },
    });
    expect(readFileSync(join(projectDir, "src/Hero.tsx"), "utf8")).toContain("HeroImg");
  });

  it("runs a command through the channel", async () => {
    const res: any = await client.callTool({
      name: "run_command",
      arguments: { command: "cat package.json" },
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.stdout).toContain("lp");
    expect(payload.exitCode).toBe(0);
  });

  it("captures a browser screenshot through the channel", async () => {
    const res: any = await client.callTool({
      name: "browser_screenshot",
      arguments: { port: 3000 },
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.title).toBe("Gradient Hero");
  });

  it("surfaces permission denials as tool errors when a scope is revoked", async () => {
    gate.revoke("files");
    const res: any = await client.callTool({
      name: "read_file",
      arguments: { path: "src/Hero.tsx" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/permission denied/i);
  });

  it("records activity the customer can watch", async () => {
    await client.callTool({ name: "read_file", arguments: { path: "src/Hero.tsx" } });
    expect(activity.some((a) => a.kind === "read_file")).toBe(true);
  });
});
