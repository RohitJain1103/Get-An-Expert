import { describe, expect, it } from "vitest";
// @ts-expect-error — plain JS module shared with the browser
import { MiniMcpClient } from "../public/mcp-client.js";

/**
 * Wire a MiniMcpClient to a fake server that replies to JSON-RPC frames,
 * mimicking the agent's expert MCP server over a data channel.
 */
function wire(handler: (method: string, params: any) => any) {
  let client: any;
  const sendRaw = (raw: string) => {
    const msg = JSON.parse(raw);
    if (msg.id === undefined) return; // notification, no reply
    queueMicrotask(() => {
      const result = handler(msg.method, msg.params);
      if (result && result.__error) {
        client.feed(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: result.message } }),
        );
      } else {
        client.feed(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      }
    });
  };
  client = new MiniMcpClient(sendRaw);
  return client;
}

describe("MiniMcpClient", () => {
  it("completes the initialize handshake", async () => {
    const client = wire((method) => {
      if (method === "initialize") {
        return { protocolVersion: "2025-06-18", serverInfo: { name: "get-an-expert-agent" } };
      }
      return {};
    });
    const info = await client.initialize();
    expect(info.serverInfo.name).toBe("get-an-expert-agent");
    expect(client.isInitialized).toBe(true);
  });

  it("lists tools", async () => {
    const client = wire((method) => {
      if (method === "tools/list") {
        return { tools: [{ name: "read_file" }, { name: "run_command" }] };
      }
      return {};
    });
    const tools = await client.listTools();
    expect(tools.map((t: any) => t.name)).toEqual(["read_file", "run_command"]);
  });

  it("returns the first text block from a tool call", async () => {
    const client = wire((method, params) => {
      if (method === "tools/call") {
        return { content: [{ type: "text", text: `ran: ${params.arguments.command}` }] };
      }
      return {};
    });
    const res = await client.callTool("run_command", { command: "ls" });
    expect(res.text).toBe("ran: ls");
    expect(res.isError).toBe(false);
  });

  it("flags tool errors", async () => {
    const client = wire((method) => {
      if (method === "tools/call") {
        return { isError: true, content: [{ type: "text", text: "Permission denied" }] };
      }
      return {};
    });
    const res = await client.callTool("read_file", { path: "x" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/permission denied/i);
  });

  it("rejects the promise on a JSON-RPC error", async () => {
    const client = wire((method) => {
      if (method === "tools/list") return { __error: true, message: "boom" };
      return {};
    });
    await expect(client.listTools()).rejects.toThrow(/boom/);
  });

  it("fails in-flight requests when the channel closes", async () => {
    const client = new MiniMcpClient(() => {});
    const p = client.listTools();
    client.fail("channel closed");
    await expect(p).rejects.toThrow(/channel closed/);
  });

  it("times out a request whose reply never arrives", async () => {
    // A dropped/oversized frame gets no reply; without a deadline the request
    // would hang forever and the UI would sit on "Loading…".
    const client = new MiniMcpClient(() => {}, { requestTimeoutMs: 20 });
    await expect(client.listTools()).rejects.toThrow(/timed out/i);
  });

  it("ignores inbound notifications without an id", () => {
    const client = new MiniMcpClient(() => {});
    // Should not throw.
    client.feed(JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} }));
  });
});
