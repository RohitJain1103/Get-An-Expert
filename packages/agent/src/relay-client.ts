import WebSocket from "ws";
import type { Grant } from "./permissions";

export interface RelayClientEvents {
  onExpertJoined?: (expertName: string) => void;
  onExpertLeft?: () => void;
  onSignal?: (payload: unknown) => void;
  onSessionEnded?: (reason: string | undefined) => void;
  onClose?: () => void;
}

export interface RegisterInput {
  customerName: string;
  projectDir: string;
  issue?: string;
}

/**
 * The agent's connection to the relay (customer machine → relay). It registers
 * the session, reports metadata (permission changes + activity summaries),
 * shuttles opaque WebRTC signaling to the claimed expert, and surfaces relay
 * events. It never sends file contents, terminal output, or browser data.
 */
export class RelayClient {
  #ws?: WebSocket;
  #sessionId?: string;
  #events: RelayClientEvents = {};
  readonly #url: string;

  constructor(relayUrl: string) {
    // Accept http(s):// or ws(s):// and normalize to the /agent ws endpoint.
    this.#url = relayUrl
      .replace(/^http/, "ws")
      .replace(/\/+$/, "");
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  on(events: RelayClientEvents): void {
    this.#events = { ...this.#events, ...events };
  }

  /** Connect and register a session; resolves with the relay's session id. */
  register(input: RegisterInput): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.#url}/agent`);
      this.#ws = ws;

      const onError = (err: Error) => reject(err);
      ws.once("error", onError);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "register",
            customerName: input.customerName,
            projectDir: input.projectDir,
            issue: input.issue,
          }),
        );
      });

      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!this.#sessionId && msg.type === "registered") {
          this.#sessionId = msg.sessionId;
          ws.off("error", onError);
          resolve(msg.sessionId);
          return;
        }
        this.#dispatch(msg);
      });

      ws.on("close", () => this.#events.onClose?.());
    });
  }

  #dispatch(msg: any): void {
    switch (msg.type) {
      case "expert-joined":
        this.#events.onExpertJoined?.(msg.expertName);
        break;
      case "expert-left":
        this.#events.onExpertLeft?.();
        break;
      case "signal":
        this.#events.onSignal?.(msg.payload);
        break;
      case "session-ended":
        this.#events.onSessionEnded?.(msg.reason);
        break;
    }
  }

  #send(msg: unknown): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  reportPermissions(permissions: Grant): void {
    this.#send({ type: "metadata", permissions });
  }

  reportActivity(entry: { kind: string; summary: string }): void {
    this.#send({ type: "metadata", activity: entry });
  }

  sendSignal(payload: unknown): void {
    this.#send({ type: "signal", payload });
  }

  end(reason?: string): void {
    this.#send({ type: "end", reason });
  }

  close(): void {
    this.#ws?.close();
  }
}
