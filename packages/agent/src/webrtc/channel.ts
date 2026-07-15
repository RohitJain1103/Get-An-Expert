/**
 * Minimal transport-agnostic message channel. Both a WebRTC data channel
 * (via node-datachannel) and an in-memory test loopback implement this, so
 * the MCP transport built on top can be exercised without real networking.
 */
export interface RawChannel {
  /** The channel's label (e.g. "mcp" or "pty") — used to route by purpose. */
  readonly label: string;
  /** Send one text frame. */
  send(data: string): void;
  /** Register a handler for inbound text frames. */
  onMessage(handler: (data: string) => void): void;
  /** Register a handler for channel close. */
  onClose(handler: () => void): void;
  /** True while the channel can send. */
  isOpen(): boolean;
  /** Close the channel. */
  close(): void;
}

/**
 * A pair of RawChannels wired directly to each other, for tests. Delivery is
 * deferred a microtask to mimic async transport ordering.
 */
export function createLoopbackPair(label = "mcp"): [RawChannel, RawChannel] {
  const a = new LoopbackChannel(label);
  const b = new LoopbackChannel(label);
  a.link(b);
  b.link(a);
  return [a, b];
}

class LoopbackChannel implements RawChannel {
  readonly label: string;
  #peer?: LoopbackChannel;
  #open = true;
  #messageHandlers: ((data: string) => void)[] = [];
  #closeHandlers: (() => void)[] = [];

  constructor(label: string) {
    this.label = label;
  }

  link(peer: LoopbackChannel): void {
    this.#peer = peer;
  }

  send(data: string): void {
    if (!this.#open) return;
    const peer = this.#peer;
    if (!peer) return;
    queueMicrotask(() => {
      if (peer.#open) {
        for (const handler of peer.#messageHandlers) handler(data);
      }
    });
  }

  onMessage(handler: (data: string) => void): void {
    this.#messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.#closeHandlers.push(handler);
  }

  isOpen(): boolean {
    return this.#open;
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    for (const handler of this.#closeHandlers) handler();
    const peer = this.#peer;
    if (peer && peer.#open) queueMicrotask(() => peer.close());
  }
}
