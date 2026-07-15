import nodeDataChannel, {
  type DataChannel,
  type PeerConnection,
  type RtcConfig,
} from "node-datachannel";
import type { RawChannel } from "./channel";
import { parseSignal, type SignalPayload } from "./signal";

export type PeerRole = "offerer" | "answerer";

export interface NodePeerOptions {
  role: PeerRole;
  /** Send a signaling payload to the other side (routed opaquely via relay). */
  sendSignal: (payload: SignalPayload) => void;
  /** STUN/TURN servers. Defaults to a public STUN server. */
  iceServers?: RtcConfig["iceServers"];
  /** Data channel label(s) the offerer creates (both sides route by label). */
  label?: string;
  labels?: string[];
}

const DEFAULT_ICE: RtcConfig["iceServers"] = ["stun:stun.l.google.com:19302"];

/**
 * Wraps a node-datachannel PeerConnection for one Get An Expert session and produces
 * a RawChannel once the MCP data channel opens. Signaling (SDP + ICE) is
 * handed to `sendSignal` and fed back in via `handleSignal` — the relay just
 * shuttles those payloads; it never sees the peer-to-peer data that follows.
 */
export class NodePeer {
  readonly #pc: PeerConnection;
  readonly #role: PeerRole;
  readonly #dcs = new Set<DataChannel>();
  #onChannel?: (channel: RawChannel) => void;
  #onError?: (err: Error) => void;
  #closed = false;

  constructor(options: NodePeerOptions) {
    this.#role = options.role;
    this.#pc = new nodeDataChannel.PeerConnection(`get-an-expert-${options.role}`, {
      iceServers: options.iceServers ?? DEFAULT_ICE,
    });

    this.#pc.onLocalDescription((sdp, type) => {
      options.sendSignal({
        kind: "description",
        sdp,
        sdpType: type as "offer" | "answer",
      });
    });
    this.#pc.onLocalCandidate((candidate, mid) => {
      options.sendSignal({ kind: "candidate", candidate, mid });
    });

    if (options.role === "offerer") {
      const labels = options.labels ?? [options.label ?? "mcp"];
      for (const label of labels) {
        this.#bindChannel(this.#pc.createDataChannel(label));
      }
    } else {
      this.#pc.onDataChannel((dc) => this.#bindChannel(dc));
    }
  }

  /** Register the callback fired once each data channel opens. Fires per
   * channel; use channel.label to route (e.g. "mcp" vs "pty"). */
  onChannel(cb: (channel: RawChannel) => void): void {
    this.#onChannel = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.#onError = cb;
  }

  /** Feed an inbound signaling payload from the other side. */
  handleSignal(payload: unknown): void {
    const signal = parseSignal(payload);
    if (!signal) {
      this.#onError?.(new Error("Dropped malformed signaling payload"));
      return;
    }
    try {
      if (signal.kind === "description") {
        this.#pc.setRemoteDescription(signal.sdp, signal.sdpType);
      } else {
        this.#pc.addRemoteCandidate(signal.candidate, signal.mid ?? "");
      }
    } catch (err) {
      this.#onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const dc of this.#dcs) {
      try {
        dc.close();
      } catch {
        /* ignore */
      }
    }
    try {
      this.#pc.close();
    } catch {
      /* ignore */
    }
  }

  #bindChannel(dc: DataChannel): void {
    this.#dcs.add(dc);
    const channel: RawChannel = {
      label: dc.getLabel(),
      send: (data) => {
        dc.sendMessage(data);
      },
      onMessage: (handler) => {
        dc.onMessage((msg) => handler(typeof msg === "string" ? msg : msg.toString()));
      },
      onClose: (handler) => {
        dc.onClosed(handler);
      },
      isOpen: () => dc.isOpen(),
      close: () => dc.close(),
    };
    if (dc.isOpen()) {
      this.#onChannel?.(channel);
    } else {
      dc.onOpen(() => this.#onChannel?.(channel));
    }
  }
}

/** Release native node-datachannel resources (call once at process exit). */
export function cleanupWebrtc(): void {
  nodeDataChannel.cleanup();
}
