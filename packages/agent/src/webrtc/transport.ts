import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RawChannel } from "./channel";

/**
 * An MCP Transport backed by a RawChannel (a WebRTC data channel in
 * production). Each JSON-RPC message is sent as one newline-free text frame;
 * inbound frames are parsed and validated against the MCP message schema.
 *
 * This is what lets the expert's dashboard speak MCP to the agent on the
 * customer's machine peer-to-peer — the relay never sees these frames.
 */
export class DataChannelTransport implements Transport {
  #channel: RawChannel;
  #started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(channel: RawChannel) {
    this.#channel = channel;
  }

  async start(): Promise<void> {
    if (this.#started) {
      throw new Error("DataChannelTransport already started");
    }
    this.#started = true;
    this.#channel.onMessage((data) => this.#handleFrame(data));
    this.#channel.onClose(() => this.onclose?.());
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.#channel.isOpen()) {
      throw new Error("Cannot send on a closed data channel");
    }
    this.#channel.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    this.#channel.close();
  }

  #handleFrame(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      this.onerror?.(new Error(`Invalid JSON frame: ${errText(err)}`));
      return;
    }
    const result = JSONRPCMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.onerror?.(new Error(`Invalid MCP message: ${result.error.message}`));
      return;
    }
    this.onmessage?.(result.data);
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
