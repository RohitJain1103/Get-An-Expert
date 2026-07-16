import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildChatUrl } from "./chat-url";
import { createExpertServer } from "./expert-server";
import { PermissionGate, type Grant, type Scope } from "./permissions";
import { RelayClient } from "./relay-client";
import { SessionLog } from "./session";
import { AgentTools } from "./tools";
import { AutoBrowserController } from "./browser-auto";
import { PtyBridge } from "./pty";
import { DataChannelTransport } from "./webrtc/transport";
import { NodePeer } from "./webrtc/peer";
import type { RawChannel } from "./webrtc/channel";
import type { ActivityEntry, BrowserController, SessionSummary } from "./types";

export interface AgentSessionOptions {
  relayUrl: string;
  projectDir: string;
  customerName: string;
  browser?: BrowserController;
  /** Peer factory override (defaults to a real WebRTC NodePeer). */
  peerFactory?: (opts: {
    role: "answerer";
    sendSignal: (payload: unknown) => void;
  }) => Peer;
  /** Notified whenever the live activity log gains an entry. */
  onActivity?: (entry: ActivityEntry) => void;
  /** Notified when the expert connects / disconnects / the session ends. */
  onExpertJoined?: (expertName: string) => void;
  onSessionEnded?: (reason: string | undefined) => void;
  log?: (line: string) => void;
}

/** The subset of NodePeer the session depends on (injectable for tests). */
export interface Peer {
  onChannel(cb: (channel: RawChannel) => void): void;
  onError(cb: (err: Error) => void): void;
  handleSignal(payload: unknown): void;
  close(): void;
}

export type SessionState = "idle" | "waiting" | "connected" | "ended";

/**
 * Orchestrates one customer-side Get An Expert session: registers with the relay,
 * gates permissions, and — when an expert claims the session — establishes the
 * peer-to-peer WebRTC channel and serves the expert MCP tools over it. The
 * customer-facing MCP server calls these methods; the customer stays in
 * control of every scope the whole time.
 */
export class AgentSession {
  readonly #gate: PermissionGate;
  readonly #log = new SessionLog();
  readonly #tools: AgentTools;
  readonly #relay: RelayClient;
  readonly #opts: AgentSessionOptions;
  readonly #logLine: (line: string) => void;

  #state: SessionState = "idle";
  #expertName?: string;
  #peer?: Peer;
  #expertServer?: McpServer;
  #ptys = new Set<PtyBridge>();
  #startedAt = 0;
  #contextWritten = false;
  readonly #browser: BrowserController;

  constructor(opts: AgentSessionOptions) {
    this.#opts = opts;
    this.#logLine = opts.log ?? (() => {});
    this.#gate = new PermissionGate(opts.projectDir);
    this.#relay = new RelayClient(opts.relayUrl);
    this.#browser =
      opts.browser ??
      new AutoBrowserController({
        onFallback: (reason) =>
          this.#logLine(`no headless browser available, using HTTP checks: ${reason}`),
      });
    this.#tools = new AgentTools({
      gate: this.#gate,
      browser: this.#browser,
      onActivity: (entry) => this.#handleActivity(entry),
    });
  }

  get state(): SessionState {
    return this.#state;
  }

  get sessionId(): string | undefined {
    return this.#relay.sessionId;
  }

  get expertName(): string | undefined {
    return this.#expertName;
  }

  /** Hosted chat-page URL for this session, or undefined when the relay
   * didn't mint a customer token (old relays) or registration hasn't run. */
  get chatUrl(): string | undefined {
    const sessionId = this.#relay.sessionId;
    const customerToken = this.#relay.customerToken;
    if (!sessionId || !customerToken) return undefined;
    return buildChatUrl(this.#opts.relayUrl, sessionId, customerToken);
  }

  /** Register the session with the relay and wait for an expert to claim it. */
  async requestExpert(issue?: string): Promise<{ sessionId: string }> {
    if (this.#state !== "idle") {
      throw new Error(`Cannot request an expert from state "${this.#state}"`);
    }
    this.#relay.on({
      onExpertJoined: (name) => this.#onExpertJoined(name),
      onExpertLeft: () => this.#onExpertLeft(),
      onSignal: (payload) => this.#peer?.handleSignal(payload),
      onSessionEnded: (reason) => this.#finish(reason, false),
      onClose: () => {
        if (this.#state !== "ended") this.#finish("relay disconnected", false);
      },
    });
    const sessionId = await this.#relay.register({
      customerName: this.#opts.customerName,
      projectDir: this.#opts.projectDir,
      issue,
    });
    this.#state = "waiting";
    this.#startedAt = Date.now();
    this.#logLine(`session ${sessionId} registered, waiting for an expert`);
    return { sessionId };
  }

  /** Grant (or replace) the approved scopes and report them to the customer's view. */
  grant(grant: Grant): Grant {
    this.#gate.grant(grant);
    this.#relay.reportPermissions(this.#gate.snapshot());
    this.#logLine(`permissions granted: ${JSON.stringify(this.#gate.snapshot())}`);
    return this.#gate.snapshot();
  }

  /** Revoke one scope (or all) immediately. */
  revoke(scope: Scope | "all"): Grant {
    if (scope === "all") this.#gate.revokeAll();
    else this.#gate.revoke(scope);
    // Revoking Terminal kills any live interactive shell immediately.
    if (scope === "terminal" || scope === "all") {
      for (const pty of this.#ptys) pty.kill(`terminal access revoked (${scope})`);
    }
    this.#relay.reportPermissions(this.#gate.snapshot());
    this.#logLine(`permission revoked: ${scope}`);
    return this.#gate.snapshot();
  }

  permissions(): Grant {
    return this.#gate.snapshot();
  }

  activity(): readonly ActivityEntry[] {
    return this.#log.entries();
  }

  status(): {
    state: SessionState;
    sessionId?: string;
    expertName?: string;
    chatUrl?: string;
    permissions: Grant;
    recentActivity: ActivityEntry[];
  } {
    return {
      state: this.#state,
      sessionId: this.#relay.sessionId,
      expertName: this.#expertName,
      chatUrl: this.chatUrl,
      permissions: this.#gate.snapshot(),
      recentActivity: this.#log.entries().slice(-20),
    };
  }

  /**
   * Write the expert hand-off file at <projectDir>/.get-an-expert/CONTEXT.md
   * and log it in the activity feed so the customer sees exactly what the
   * expert can read. The directory is removed again when the session ends.
   */
  async writeContext(markdown: string): Promise<void> {
    const dir = join(this.#opts.projectDir, ".get-an-expert");
    await mkdir(dir, { recursive: true });
    // Self-ignore: if the agent is killed (crash / power loss) before the
    // dir is cleaned up on session end, this keeps a stray `git add -A` from
    // staging the transcript regardless of the project's root .gitignore.
    await writeFile(join(dir, ".gitignore"), "*\n", "utf8");
    await writeFile(join(dir, "CONTEXT.md"), markdown, "utf8");
    this.#contextWritten = true;
    this.#handleActivity({
      at: Date.now(),
      kind: "context",
      summary: "Session context written: .get-an-expert/CONTEXT.md",
    });
  }

  /**
   * Synchronously remove the context dir. For signal handlers (SIGINT/SIGTERM)
   * that must finish before process.exit, where the async #finish cleanup
   * can't run to completion.
   */
  cleanupContextSync(): void {
    if (!this.#contextWritten) return;
    this.#contextWritten = false;
    try {
      rmSync(join(this.#opts.projectDir, ".get-an-expert"), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  /** End the session: revoke everything, tear down the peer, return a summary. */
  async end(reason = "customer ended the session"): Promise<SessionSummary> {
    const summary = this.#buildSummary(reason);
    this.#relay.end(reason);
    await this.#finish(reason, true);
    return summary;
  }

  #buildSummary(_reason: string): SessionSummary {
    return this.#log.summary({
      expertName: this.#expertName,
      startedAt: this.#startedAt || Date.now(),
      endedAt: Date.now(),
      permissions: this.#gate.snapshot(),
    });
  }

  #handleActivity(entry: ActivityEntry): void {
    this.#log.record(entry);
    this.#relay.reportActivity({ kind: entry.kind, summary: entry.summary });
    this.#opts.onActivity?.(entry);
  }

  #onExpertJoined(name: string): void {
    this.#expertName = name;
    this.#state = "connected";
    this.#logLine(`expert ${name} joined; establishing peer connection`);
    this.#opts.onExpertJoined?.(name);

    const makePeer =
      this.#opts.peerFactory ??
      (({ role, sendSignal }) =>
        new NodePeer({
          role,
          sendSignal: (payload) => sendSignal(payload),
        }));
    const peer = makePeer({
      role: "answerer",
      sendSignal: (payload) => this.#relay.sendSignal(payload),
    });
    peer.onError((err) => this.#logLine(`peer error: ${err.message}`));
    peer.onChannel((channel) => this.#routeChannel(channel));
    this.#peer = peer;
  }

  /** Route each peer-to-peer data channel by its label. The dashboard opens
   * extra terminals as "pty-2", "pty-3", … — each gets its own PtyBridge. */
  #routeChannel(channel: RawChannel): void {
    if (channel.label === "pty" || channel.label.startsWith("pty-")) {
      this.#serveTerminal(channel);
    } else {
      void this.#serveExpert(channel);
    }
  }

  async #serveExpert(channel: RawChannel): Promise<void> {
    this.#logLine("mcp channel open; serving expert tools peer-to-peer");
    const server = createExpertServer(this.#tools);
    this.#expertServer = server;
    await server.connect(new DataChannelTransport(channel));
  }

  #serveTerminal(channel: RawChannel): void {
    this.#logLine("pty channel open; interactive terminal available");
    const bridge = new PtyBridge(channel, {
      gate: this.#gate,
      projectDir: this.#opts.projectDir,
      onActivity: (entry) => this.#handleActivity(entry),
      log: this.#logLine,
    });
    this.#ptys.add(bridge);
    channel.onClose(() => this.#ptys.delete(bridge));
  }

  #onExpertLeft(): void {
    this.#logLine("expert left; tearing down peer connection");
    this.#expertName = undefined;
    this.#teardownPeer();
    if (this.#state === "connected") this.#state = "waiting";
  }

  async #finish(reason: string | undefined, revoke: boolean): Promise<void> {
    if (this.#state === "ended") return;
    this.#state = "ended";
    if (revoke) this.#gate.revokeAll();
    this.#teardownPeer();
    this.#relay.close();
    void this.#browser.close?.().catch(() => {});
    if (this.#contextWritten) {
      // Best-effort: the context file only exists for the expert session.
      this.#contextWritten = false;
      await rm(join(this.#opts.projectDir, ".get-an-expert"), {
        recursive: true,
        force: true,
      }).catch(() => {});
    }
    this.#logLine(`session ended: ${reason ?? "unknown"}`);
    this.#opts.onSessionEnded?.(reason);
  }

  #teardownPeer(): void {
    for (const pty of this.#ptys) pty.kill("peer torn down");
    this.#ptys.clear();
    try {
      this.#peer?.close();
    } catch {
      /* ignore */
    }
    this.#peer = undefined;
    const server = this.#expertServer;
    this.#expertServer = undefined;
    if (server) void server.close();
  }
}
