import WebSocket from "ws";
import type { Grant } from "./permissions";
import type { PublicExpertProfile } from "./types";

export interface RelayClientEvents {
  /** The relay sends the expert's display name and, when the session is claimed
   * by a roster expert, their public profile (absent on older relays). */
  onExpertJoined?: (expertName: string, profile?: PublicExpertProfile) => void;
  onExpertLeft?: () => void;
  onSignal?: (payload: unknown) => void;
  onSessionEnded?: (reason: string | undefined) => void;
  /** The connection closed for good (intentional end, or never registered). */
  onClose?: () => void;
  /** A reconnect attempt is starting after an unexpected drop. */
  onReconnecting?: (attempt: number) => void;
  /** The relay accepted a resume — the request is back online. */
  onResumed?: (status: { status?: string; expertName?: string }) => void;
  /** The relay rejected a resume — the session is gone (expired/ended). */
  onResumeFailed?: () => void;
}

export interface RegisterInput {
  customerName: string;
  projectDir: string;
  issue?: string;
}

/** The subset of the relay connection AgentSession depends on (injectable). */
export interface RelayConnection {
  readonly sessionId: string | undefined;
  readonly customerToken: string | undefined;
  readonly resumeToken: string | undefined;
  on(events: RelayClientEvents): void;
  register(input: RegisterInput): Promise<string>;
  resume(sessionId: string, resumeToken: string): Promise<void>;
  reportPermissions(permissions: Grant): void;
  reportActivity(entry: { kind: string; summary: string }): void;
  sendSignal(payload: unknown): void;
  end(reason?: string): void;
  close(): void;
}

/** The minimal WebSocket surface used here, so tests can inject a fake. */
export interface WsLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  on(event: string, cb: (...args: any[]) => void): void;
  once(event: string, cb: (...args: any[]) => void): void;
}

export interface RelayClientOptions {
  /** WebSocket factory (defaults to the real `ws` client). */
  wsFactory?: (url: string) => WsLike;
  /** Base reconnect backoff in ms (defaults to 1000). */
  baseDelayMs?: number;
  /** Max reconnect backoff in ms (defaults to 30000). */
  maxDelayMs?: number;
}

const WS_OPEN = 1;

type FirstAction =
  | { kind: "register"; input: RegisterInput }
  | { kind: "resume"; sessionId: string; resumeToken: string };

/**
 * The agent's connection to the relay (customer machine → relay). It registers
 * the session, reports metadata, shuttles opaque WebRTC signaling, and — the
 * durable-inbox behavior — automatically reconnects and RESUMES the same queued
 * request when the socket drops (sleep, Wi-Fi blip, relay redeploy), so a
 * request never disappears just because the connection flickered. It only stops
 * reconnecting on an intentional end or a relay-confirmed resume failure. It
 * never sends file contents, terminal output, or browser data.
 */
export class RelayClient implements RelayConnection {
  #ws?: WsLike;
  #sessionId?: string;
  #customerToken?: string;
  #resumeToken?: string;
  #events: RelayClientEvents = {};
  readonly #url: string;
  readonly #wsFactory: (url: string) => WsLike;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;

  /** True once we intentionally close, or the session ended — no reconnecting. */
  #intentional = false;
  #reconnectAttempt = 0;
  #reconnectTimer?: ReturnType<typeof setTimeout>;
  #pendingRegister?: { resolve: (id: string) => void; reject: (err: Error) => void };
  #pendingResume?: { resolve: () => void; reject: (err: Error) => void };

  constructor(relayUrl: string, options: RelayClientOptions = {}) {
    // Accept http(s):// or ws(s):// and normalize to the /agent ws endpoint.
    this.#url = relayUrl.replace(/^http/, "ws").replace(/\/+$/, "");
    this.#wsFactory =
      options.wsFactory ?? ((url) => new WebSocket(url) as unknown as WsLike);
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#maxDelayMs = options.maxDelayMs ?? 30000;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  get customerToken(): string | undefined {
    return this.#customerToken;
  }

  /** Raw resume token minted by the relay; the agent persists it to reconnect. */
  get resumeToken(): string | undefined {
    return this.#resumeToken;
  }

  on(events: RelayClientEvents): void {
    this.#events = { ...this.#events, ...events };
  }

  /** Connect and register a new session; resolves with the relay's session id. */
  register(input: RegisterInput): Promise<string> {
    return new Promise((resolve, reject) => {
      this.#pendingRegister = { resolve, reject };
      this.#connect({ kind: "register", input });
    });
  }

  /** Reconnect to an existing queued session (process-restart resume). */
  resume(sessionId: string, resumeToken: string): Promise<void> {
    this.#sessionId = sessionId;
    this.#resumeToken = resumeToken;
    return new Promise((resolve, reject) => {
      this.#pendingResume = { resolve, reject };
      this.#connect({ kind: "resume", sessionId, resumeToken });
    });
  }

  #connect(first: FirstAction): void {
    const ws = this.#wsFactory(`${this.#url}/agent`);
    this.#ws = ws;

    ws.once("error", (err: Error) => {
      // A failure before we're registered rejects the caller's promise; after
      // that, the "close" that follows drives the reconnect instead.
      if (this.#pendingRegister) {
        this.#pendingRegister.reject(err);
        this.#pendingRegister = undefined;
      } else if (this.#pendingResume) {
        this.#pendingResume.reject(err);
        this.#pendingResume = undefined;
      }
    });

    ws.on("open", () => {
      if (first.kind === "register") {
        this.#rawSend(ws, {
          type: "register",
          customerName: first.input.customerName,
          projectDir: first.input.projectDir,
          issue: first.input.issue,
        });
      } else {
        this.#rawSend(ws, {
          type: "resume",
          sessionId: first.sessionId,
          resumeToken: first.resumeToken,
        });
      }
    });

    ws.on("message", (raw: unknown) => this.#onMessage(raw));
    ws.on("close", () => this.#onClose());
  }

  #onMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case "registered":
        this.#sessionId = msg.sessionId;
        if (typeof msg.customerToken === "string") this.#customerToken = msg.customerToken;
        if (typeof msg.resumeToken === "string") this.#resumeToken = msg.resumeToken;
        this.#reconnectAttempt = 0;
        this.#pendingRegister?.resolve(msg.sessionId);
        this.#pendingRegister = undefined;
        return;
      case "resumed":
        this.#reconnectAttempt = 0;
        if (typeof msg.customerToken === "string") this.#customerToken = msg.customerToken;
        this.#pendingResume?.resolve();
        this.#pendingResume = undefined;
        this.#events.onResumed?.({ status: msg.status, expertName: msg.expertName });
        return;
      case "resume-failed":
        // The session is gone server-side; stop trying to reconnect to it.
        this.#intentional = true;
        this.#clearReconnect();
        this.#pendingResume?.reject(new Error(msg.reason ?? "resume failed"));
        this.#pendingResume = undefined;
        this.#events.onResumeFailed?.();
        return;
      case "expert-joined":
        this.#events.onExpertJoined?.(msg.expertName, msg.expert);
        return;
      case "expert-left":
        this.#events.onExpertLeft?.();
        return;
      case "signal":
        this.#events.onSignal?.(msg.payload);
        return;
      case "session-ended":
        // A relay-side end is terminal — do not reconnect after the socket drops.
        this.#intentional = true;
        this.#clearReconnect();
        this.#events.onSessionEnded?.(msg.reason);
        return;
    }
  }

  #onClose(): void {
    if (this.#intentional) {
      this.#events.onClose?.();
      return;
    }
    // Unexpected drop with a known session → reconnect and resume. Without a
    // session id yet (initial connect never registered) it's a hard failure.
    if (this.#sessionId && this.#resumeToken) {
      this.#scheduleReconnect();
    } else {
      this.#events.onClose?.();
    }
  }

  #scheduleReconnect(): void {
    this.#reconnectAttempt += 1;
    const backoff = Math.min(
      this.#maxDelayMs,
      this.#baseDelayMs * 2 ** (this.#reconnectAttempt - 1),
    );
    const delay = backoff / 2 + Math.floor(Math.random() * (backoff / 2 + 1));
    this.#events.onReconnecting?.(this.#reconnectAttempt);
    this.#reconnectTimer = setTimeout(() => {
      if (this.#intentional || !this.#sessionId || !this.#resumeToken) return;
      this.#connect({
        kind: "resume",
        sessionId: this.#sessionId,
        resumeToken: this.#resumeToken,
      });
    }, delay);
    this.#reconnectTimer.unref?.();
  }

  #clearReconnect(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
  }

  #rawSend(ws: WsLike, msg: unknown): void {
    if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(msg));
  }

  #send(msg: unknown): void {
    if (this.#ws && this.#ws.readyState === WS_OPEN) {
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
    this.#intentional = true;
    this.#clearReconnect();
    this.#ws?.close();
  }
}
