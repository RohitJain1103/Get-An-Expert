// Minimal MCP (JSON-RPC 2.0) client for the expert dashboard.
//
// It speaks to the Get An Expert agent's expert MCP server over a WebRTC data channel:
// each request is one JSON frame, each response one JSON frame. Kept dependency
// -free and transport-agnostic (any `sendRaw(string)` + `feed(string)` pair) so
// it runs in the browser and is unit-testable in Node.
//
// The design's peer-to-peer promise lives here: these frames travel directly
// between the expert and the customer's machine; the relay never sees them.

const PROTOCOL_VERSION = "2025-06-18";

export class MiniMcpClient {
  #sendRaw;
  #nextId = 1;
  #pending = new Map();
  #initialized = false;

  constructor(sendRaw) {
    this.#sendRaw = sendRaw;
  }

  /** Feed one inbound JSON frame from the data channel. */
  feed(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // notification
    const entry = this.#pending.get(msg.id);
    if (!entry) return;
    this.#pending.delete(msg.id);
    if (msg.error) {
      entry.reject(new Error(msg.error.message || "MCP error"));
    } else {
      entry.resolve(msg.result);
    }
  }

  #request(method, params) {
    const id = this.#nextId++;
    const frame = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#sendRaw(JSON.stringify(frame));
      } catch (err) {
        this.#pending.delete(id);
        reject(err);
      }
    });
  }

  #notify(method, params) {
    this.#sendRaw(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** Run the MCP initialize handshake. Returns the server info. */
  async initialize() {
    const result = await this.#request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "get-an-expert-dashboard", version: "0.1.0" },
    });
    this.#notify("notifications/initialized", {});
    this.#initialized = true;
    return result;
  }

  get isInitialized() {
    return this.#initialized;
  }

  async listTools() {
    const result = await this.#request("tools/list", {});
    return result?.tools ?? [];
  }

  /** Call a tool; returns { text, isError } with the first text block. */
  async callTool(name, args) {
    const result = await this.#request("tools/call", { name, arguments: args ?? {} });
    const block = result?.content?.find((c) => c.type === "text");
    return { text: block?.text ?? "", isError: result?.isError === true, raw: result };
  }

  /** Reject every in-flight request (call when the channel closes). */
  fail(reason) {
    const err = new Error(reason || "connection closed");
    for (const { reject } of this.#pending.values()) reject(err);
    this.#pending.clear();
  }
}
