import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  clearResume,
  clearSessionStatus,
  writeResume,
  writeSessionStatus,
  type ResumeRecord,
} from "@get-an-expert/core/relay";
import { buildChatUrl } from "./chat-url";
import { buildContextMarkdown, type ContextInput } from "./context";
import { createExpertServer } from "./expert-server";
import { PermissionGate, type Grant, type Scope } from "./permissions";
import { RelayClient, type ContextManifest, type RelayConnection } from "./relay-client";
import { SessionLog } from "./session";
import { AgentTools } from "./tools";
import { AutoBrowserController } from "./browser-auto";
import { PtyBridge } from "./pty";
import { DataChannelTransport } from "./webrtc/transport";
import { NodePeer } from "./webrtc/peer";
import type { RawChannel } from "./webrtc/channel";
import type {
  ActivityEntry,
  BrowserController,
  PublicExpertProfile,
  SessionSummary,
} from "./types";

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
  /** Relay connection factory (defaults to a real RelayClient; injectable for tests). */
  relayClientFactory?: (relayUrl: string) => RelayConnection;
  /** Notified whenever the live activity log gains an entry. */
  onActivity?: (entry: ActivityEntry) => void;
  /** Notified when the expert connects / disconnects / the session ends. The
   * profile is present when a roster expert claimed the session. */
  onExpertJoined?: (expertName: string, profile?: PublicExpertProfile) => void;
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
  readonly #relay: RelayConnection;
  readonly #opts: AgentSessionOptions;
  readonly #logLine: (line: string) => void;

  #state: SessionState = "idle";
  #expertName?: string;
  #expertProfile?: PublicExpertProfile;
  /** The last delivered fix and whether the customer confirmed it, surfaced in
   * expert_status. Undefined until the expert first delivers. */
  #lastDelivery?: { summary: string; accepted?: boolean };
  #peer?: Peer;
  #expertServer?: McpServer;
  #ptys = new Set<PtyBridge>();
  #startedAt = 0;
  #contextWritten = false;
  /** The issue text and request time, kept so the resume record can be rebuilt. */
  #issue?: string;
  /** The inputs the CONTEXT.md was built from, kept so an issue edit can rebuild
   * it in place (patching just the issue) without re-reading the transcript. */
  #contextInput?: ContextInput;
  #requestedAt = 0;
  readonly #browser: BrowserController;

  constructor(opts: AgentSessionOptions) {
    this.#opts = opts;
    this.#logLine = opts.log ?? (() => {});
    this.#gate = new PermissionGate(opts.projectDir);
    this.#relay = opts.relayClientFactory
      ? opts.relayClientFactory(opts.relayUrl)
      : new RelayClient(opts.relayUrl);
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

  /** The connected expert's public profile, when a roster expert claimed the
   * session. Undefined while waiting, after they leave, or on older relays. */
  get expertProfile(): PublicExpertProfile | undefined {
    return this.#expertProfile;
  }

  /** The last delivered fix (summary + whether the customer confirmed it), for
   * expert_status. Undefined until the expert delivers. */
  get lastDelivery(): { summary: string; accepted?: boolean } | undefined {
    return this.#lastDelivery;
  }

  /** Hosted chat-page URL for this session, or undefined when the relay
   * didn't mint a customer token (old relays) or registration hasn't run. */
  get chatUrl(): string | undefined {
    const sessionId = this.#relay.sessionId;
    const customerToken = this.#relay.customerToken;
    if (!sessionId || !customerToken) return undefined;
    return buildChatUrl(this.#opts.relayUrl, sessionId, customerToken);
  }

  /** Wire the relay events once (shared by requestExpert and resumeExpert). */
  #wireRelayEvents(): void {
    this.#relay.on({
      onExpertJoined: (name, profile) => this.#onExpertJoined(name, profile),
      onExpertLeft: () => this.#onExpertLeft(),
      onSignal: (payload) => this.#peer?.handleSignal(payload),
      onIssueUpdated: (issue) => this.#onIssueUpdated(issue),
      onDelivered: (summary) => this.#onDelivered(summary),
      onDeliveryAccepted: () => this.#onDeliveryResponse(true),
      onDeliveryDeclined: () => this.#onDeliveryResponse(false),
      onSessionEnded: (reason) => this.#finish(reason, false),
      onReconnecting: (attempt) => this.#onReconnecting(attempt),
      onResumed: (status) => this.#onResumed(status),
      // The relay says the session is gone (expired/ended). Treat it as a
      // terminal end and clear the local resume record.
      onResumeFailed: () => {
        if (this.#state !== "ended") this.#finish("session no longer available", true);
      },
      // Fires only on an intentional close (or a connect that never registered).
      // Transient drops are handled by the relay client's own reconnect loop.
      onClose: () => {
        if (this.#state !== "ended") this.#finish("relay disconnected", false);
      },
    });
  }

  /** Register the session with the relay and wait for an expert to claim it. The
   * context manifest (truthful CONTEXT.md counts) rides along on the register so
   * the customer chat page can show it as chips. */
  async requestExpert(
    issue?: string,
    contextManifest?: ContextManifest,
  ): Promise<{ sessionId: string }> {
    if (this.#state !== "idle") {
      throw new Error(`Cannot request an expert from state "${this.#state}"`);
    }
    this.#issue = issue;
    this.#requestedAt = Date.now();
    this.#wireRelayEvents();
    const sessionId = await this.#relay.register({
      customerName: this.#opts.customerName,
      projectDir: this.#opts.projectDir,
      issue,
      contextManifest,
    });
    this.#state = "waiting";
    this.#startedAt = Date.now();
    // Persist enough to rejoin this request after a reconnect or restart.
    this.#persistResume();
    this.#persistStatus();
    this.#logLine(`session ${sessionId} registered, waiting for an expert`);
    return { sessionId };
  }

  /**
   * Rejoin a request persisted before a process restart: reconnect to the
   * relay, re-arm the scopes the user already approved, and log that access is
   * live again so the customer (and expert) see it. Throws if the relay rejects
   * the resume (the session expired or ended).
   */
  async resumeExpert(record: ResumeRecord): Promise<{ sessionId: string }> {
    if (this.#state !== "idle") {
      throw new Error(`Cannot resume from state "${this.#state}"`);
    }
    this.#issue = record.issue;
    this.#requestedAt = record.createdAt;
    this.#wireRelayEvents();
    await this.#relay.resume(record.sessionId, record.resumeToken);
    this.#state = "waiting";
    this.#startedAt = Date.now();
    // Re-arm the previously approved scopes (persist-grants auto-resume).
    if (record.grant) this.grant(record.grant);
    this.#persistResume();
    this.#persistStatus();
    this.#handleActivity({
      at: Date.now(),
      kind: "resume",
      summary:
        "Session auto-resumed after restart — expert access re-armed (Files/Terminal/Browser as approved)",
    });
    this.#logLine(`session ${record.sessionId} resumed after restart`);
    return { sessionId: record.sessionId };
  }

  /** Write the local resume record (best-effort; old relays can't resume). */
  #persistResume(): void {
    const sessionId = this.#relay.sessionId;
    const resumeToken = this.#relay.resumeToken;
    if (!sessionId || !resumeToken) return;
    const grant = this.#gate.snapshot();
    const hasGrant = grant.files || grant.terminal || grant.browser;
    try {
      writeResume({
        sessionId,
        resumeToken,
        relayUrl: this.#opts.relayUrl,
        projectDir: this.#opts.projectDir,
        customerName: this.#opts.customerName,
        issue: this.#issue,
        grant: hasGrant ? grant : undefined,
        createdAt: this.#requestedAt || Date.now(),
      });
    } catch {
      // Best-effort: without it a process restart just can't auto-resume.
    }
  }

  #onReconnecting(attempt: number): void {
    this.#logLine(`relay connection lost; reconnecting (attempt ${attempt})`);
    // Do NOT tear the peer down. The WebRTC connection (and the expert's live
    // terminal on it) is peer-to-peer and independent of this relay socket —
    // the relay only carries signaling and lifecycle. Killing the peer here
    // was what closed the expert's terminal mid-command on every transient
    // relay blip. Keep the session as-is (expert name and profile included);
    // the relay holds the claim through its grace window, and we resume the
    // socket underneath a live peer.
    if (attempt === 1 && this.#state === "connected") {
      this.#handleActivity({
        at: Date.now(),
        kind: "reconnect",
        summary:
          "Relay link briefly dropped — reconnecting. The expert's session stays live.",
      });
    }
  }

  #onResumed(status: { status?: string; expertName?: string }): void {
    this.#logLine("relay connection resumed — request is back online");
    // Re-sync the relay's view of the approved scopes after the reconnect.
    this.#relay.reportPermissions(this.#gate.snapshot());
    // If the claim was released while we were away (we stayed offline past the
    // relay's grace, so the expert was returned to the queue), the peer we kept
    // is now talking to nothing — tear it down and go back to waiting. A fresh
    // expert-joined will rebuild it when someone claims again.
    if (status.status === "waiting" && this.#state === "connected") {
      this.#logLine("expert was released during the outage; returning to waiting");
      this.#teardownPeer();
      this.#expertName = undefined;
      this.#state = "waiting";
    }
    this.#persistStatus();
  }

  /** Grant (or replace) the approved scopes and report them to the customer's view. */
  grant(grant: Grant): Grant {
    this.#gate.grant(grant);
    this.#relay.reportPermissions(this.#gate.snapshot());
    // Keep the resume record's grant in sync so a restart re-arms these scopes.
    this.#persistResume();
    this.#persistStatus();
    this.#logLine(`permissions granted: ${JSON.stringify(this.#gate.snapshot())}`);
    return this.#gate.snapshot();
  }

  /**
   * Record how scope consent was obtained as an audit entry in the activity
   * log (which also flows to session status and the customer's live view).
   * Distinguishes a host-verified elicitation approval from a model-mediated
   * chat reply, so an anomalous grant is detectable after the fact.
   */
  recordConsent(via: "host approval prompt" | "your reply in chat"): void {
    this.#handleActivity({
      at: Date.now(),
      kind: "consent",
      summary: `Access approved via ${via}.`,
    });
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
    this.#persistStatus();
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
    expertProfile?: PublicExpertProfile;
    chatUrl?: string;
    issue?: string;
    lastDelivery?: { summary: string; accepted?: boolean };
    permissions: Grant;
    recentActivity: ActivityEntry[];
  } {
    return {
      state: this.#state,
      sessionId: this.#relay.sessionId,
      expertName: this.#expertName,
      expertProfile: this.#expertProfile,
      chatUrl: this.chatUrl,
      issue: this.#issue,
      lastDelivery: this.#lastDelivery,
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
   * Assemble and write CONTEXT.md from its source inputs, keeping those inputs
   * so a later issue edit can rebuild the file in place. The caller (index.ts)
   * uses this instead of building the markdown itself, so the session owns the
   * one path that produces CONTEXT.md.
   */
  async writeContextFrom(input: ContextInput): Promise<void> {
    this.#contextInput = input;
    this.#issue = input.issue;
    await this.writeContext(buildContextMarkdown(input).markdown);
  }

  /**
   * The issue was edited (customer or expert). Adopt the new text and, if
   * CONTEXT.md was already assembled, rebuild it in place so the expert's
   * hand-off file always matches the edited issue. Fires before the session is
   * claimed too (a waiting-state customer edit), in which case there is no file
   * yet and we only update the tracked issue.
   */
  #onIssueUpdated(issue: string): void {
    this.#issue = issue;
    if (!this.#contextInput) {
      this.#persistStatus();
      return;
    }
    this.#contextInput = { ...this.#contextInput, issue };
    this.#logLine("issue edited; rebuilding CONTEXT.md");
    void this.writeContext(buildContextMarkdown(this.#contextInput).markdown).catch((err) =>
      this.#logLine(`context rebuild failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** The expert delivered a fix. Record the summary so expert_status can report
   * it; a fresh deliver replaces the previous one and clears any prior response. */
  #onDelivered(summary: string): void {
    this.#lastDelivery = { summary };
    this.#logLine("expert delivered a fix");
    this.#persistStatus();
  }

  /** The customer accepted or declined the delivered fix. Accepting does not end
   * the session (decision 2026-07-17); it only marks the delivery confirmed. */
  #onDeliveryResponse(accepted: boolean): void {
    if (this.#lastDelivery) {
      this.#lastDelivery = { ...this.#lastDelivery, accepted };
    }
    this.#logLine(accepted ? "customer confirmed the fix" : "customer declined the delivery");
    this.#persistStatus();
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
    this.#persistStatus();
    this.#opts.onActivity?.(entry);
  }

  /**
   * Mirror the live session state to a local file the MCP server reads. The
   * customer's `expert_status` runs in a separate process, so without this the
   * customer's "what has the expert been doing?" answer would be stale. Removed
   * on end (see #finish) so nothing lingers after the session closes.
   */
  #persistStatus(): void {
    try {
      writeSessionStatus({
        state: this.#state,
        sessionId: this.#relay.sessionId,
        expertName: this.#expertName,
        chatUrl: this.chatUrl,
        permissions: this.#gate.snapshot() as unknown as Record<string, unknown>,
        recentActivity: this.#log
          .entries()
          .slice(-20)
          .map((e) => ({ at: e.at, kind: e.kind, summary: e.summary })),
        updatedAt: Date.now(),
      });
    } catch {
      // Best-effort: a failed write just means expert_status is briefly stale.
    }
  }

  #onExpertJoined(name: string, profile?: PublicExpertProfile): void {
    // Defensive: a fresh expert-joined should only arrive when there's no live
    // peer (a prior expert-left tore it down). If one somehow still exists,
    // drop it first so a new signaling exchange can't leak the old peer.
    if (this.#peer) this.#teardownPeer();
    this.#expertName = name;
    this.#expertProfile = profile;
    this.#state = "connected";
    this.#persistStatus();
    this.#logLine(`expert ${name} joined; establishing peer connection`);
    this.#opts.onExpertJoined?.(name, profile);

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
    this.#expertProfile = undefined;
    this.#teardownPeer();
    if (this.#state === "connected") this.#state = "waiting";
    this.#persistStatus();
  }

  async #finish(reason: string | undefined, revoke: boolean): Promise<void> {
    if (this.#state === "ended") return;
    this.#state = "ended";
    clearSessionStatus();
    // The request is truly over — drop the resume record so nothing auto-resumes.
    clearResume();
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
