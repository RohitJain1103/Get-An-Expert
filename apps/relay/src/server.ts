import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { redactText } from "@get-an-expert/core";
import { WebSocketServer, type WebSocket } from "ws";
import {
  agentMessageSchema,
  customerMessageSchema,
  expertMessageSchema,
  parseMessage,
  type AgentMessage,
  type ChatMessage,
  type CustomerMessage,
  type ExpertMessage,
} from "./protocol";
import { SessionStore, hashResumeToken, type Session } from "./sessions";
import {
  MemoryPersistence,
  type SessionPersistence,
} from "./persistence";
import { serveStatic } from "./static";
import { ROSTER, findExpert, type PublicExpertProfile } from "./roster";
import { DEFAULT_STUN, iceServers } from "./ice";

/** Default max age of a queued request before the sweep expires it (72h). */
export const DEFAULT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Grace window before a dropped socket releases an ACTIVE session's claim. */
export const DEFAULT_ACTIVE_GRACE_MS = 3 * 60 * 1000;

export interface RelayOptions {
  /** Tokens that authenticate experts. */
  expertTokens: string[];
  /** Directory of dashboard static files; omit to disable static serving. */
  dashboardDir?: string;
  /**
   * Durable session store so the queue survives a relay restart. Defaults to a
   * no-op in-memory backend (requests still survive disconnects and auto-resume;
   * only relay-restart survival needs a real backend).
   */
  persistence?: SessionPersistence;
  /** Max age of a queued request before it is expired. Defaults to 72h. */
  maxAgeMs?: number;
  /**
   * How long an ACTIVE session tolerates a dropped agent or expert socket
   * before the claim is released. The WebRTC peer is independent of these
   * sockets and usually survives a relay-WS blip — releasing immediately
   * guillotined live sessions (the expert's terminal killed mid-command) on
   * every transient drop. Defaults to 3 minutes.
   */
  activeGraceMs?: number;
  /** Called for operational logging. Never receives signal payloads. */
  log?: (line: string) => void;
}

export interface Relay {
  server: Server;
  store: SessionStore;
  /** Load persisted requests back into the queue (call once, before listen). */
  hydrate: () => Promise<void>;
}

interface ExpertConn {
  name: string;
  /** The roster profile this expert self-selected at login, if any. */
  profile?: PublicExpertProfile;
  claimed: Set<string>;
}

/** How long an expert socket may stay connected without authenticating. */
const AUTH_TIMEOUT_MS = 10_000;

/**
 * The Get An Expert relay: session discovery, WebRTC signaling passthrough,
 * expert authentication, and session metadata. It routes `signal`
 * payloads without parsing them — after the WebRTC handshake completes,
 * session data flows peer-to-peer and never touches this server.
 */
export function createRelay(options: RelayOptions): Relay {
  const store = new SessionStore();
  const log = options.log ?? (() => {});
  const persistence = options.persistence ?? new MemoryPersistence();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const activeGraceMs = options.activeGraceMs ?? DEFAULT_ACTIVE_GRACE_MS;
  const agents = new Map<string, WebSocket>(); // sessionId -> agent socket
  const experts = new Map<WebSocket, ExpertConn>(); // authed experts
  const chatSockets = new Map<string, Set<WebSocket>>(); // sessionId -> customer chat sockets
  // Pending "the other side dropped" timers for ACTIVE sessions. While one of
  // these is armed the session stays claimed — the P2P link between expert and
  // customer keeps working without the relay, so a transient socket drop must
  // not tear the session down. Cleared on resume/re-attach/re-claim/end.
  const agentGrace = new Map<string, NodeJS.Timeout>(); // sessionId -> release timer
  const expertGrace = new Map<string, NodeJS.Timeout>(); // sessionId -> release timer

  function clearAgentGrace(sessionId: string): void {
    const t = agentGrace.get(sessionId);
    if (t) clearTimeout(t);
    agentGrace.delete(sessionId);
  }

  function clearExpertGrace(sessionId: string): void {
    const t = expertGrace.get(sessionId);
    if (t) clearTimeout(t);
    expertGrace.delete(sessionId);
  }

  /** Mirror a session's durable metadata to storage; never throws into callers. */
  function persist(session: Session | undefined): void {
    if (!session) return;
    void persistence.save(session).catch((err) =>
      log(`persist failed for ${session.id}: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: store.queue().length }));
      return;
    }
    // Public roster of experts, for the customer chat bench and the dashboard
    // identity picker. Marketing data only: no token or code material lives on
    // a PublicExpertProfile, so this is safe to serve unauthenticated.
    if (new URL(req.url ?? "/", "http://relay.local").pathname === "/api/roster") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(ROSTER));
      return;
    }
    // ICE servers (STUN + optional TURN) for the peer-to-peer WebRTC leg. The
    // dashboard fetches this before creating its RTCPeerConnection so TURN
    // credentials stay server-side. Async because a TURN provider (Cloudflare)
    // may be minted on demand; any failure degrades to the STUN baseline so a
    // session is never blocked. no-store: TURN credentials are short-lived.
    if (new URL(req.url ?? "/", "http://relay.local").pathname === "/api/ice") {
      iceServers()
        .then((servers) => {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ iceServers: servers }));
        })
        .catch(() => {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ iceServers: [{ urls: DEFAULT_STUN }] }));
        });
      return;
    }
    if (options.dashboardDir) {
      // Pretty URL for the customer chat page: /chat -> /chat.html. Path
      // only — the session id + token live in the URL fragment, which never
      // reaches the server.
      const pathname = new URL(req.url ?? "/", "http://relay.local").pathname;
      if (req.method === "GET" && pathname === "/chat") req.url = "/chat.html";
      serveStatic(options.dashboardDir, req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://relay.local").pathname;
    if (path !== "/agent" && path !== "/expert" && path !== "/customer") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      trackHeartbeat(ws);
      // A WebSocket 'error' with no listener is rethrown by Node as an
      // uncaught exception, which would crash the whole relay. This fires for
      // protocol-level failures (e.g. a malformed frame) before any app
      // message is parsed, so it must be attached to every socket, on every
      // endpoint, unconditionally.
      ws.on("error", (err) => log(`ws error: ${err instanceof Error ? err.message : String(err)}`));
      if (path === "/agent") handleAgent(ws);
      else if (path === "/expert") handleExpert(ws);
      else handleCustomer(ws);
    });
  });

  // Heartbeat: without it, an idle WebSocket (the relay goes quiet once the
  // WebRTC handshake completes and data flows peer-to-peer) gets killed by
  // proxies/load balancers after a few minutes. Ping every interval and drop
  // peers that stop ponging.
  const HEARTBEAT_MS = 30_000;
  // Three missed pongs (~90s) before terminating: one miss is routine (an
  // event-loop stall, transient congestion) and single-strike termination
  // was killing healthy sockets — and with them, live expert sessions.
  const MAX_MISSED_PONGS = 3;
  const missedPongs = new WeakMap<WebSocket, number>();
  function trackHeartbeat(ws: WebSocket): void {
    missedPongs.set(ws, 0);
    ws.on("pong", () => missedPongs.set(ws, 0));
  }
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const missed = (missedPongs.get(ws) ?? 0) + 1;
      if (missed > MAX_MISSED_PONGS) {
        ws.terminate();
        continue;
      }
      missedPongs.set(ws, missed);
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  server.on("close", () => clearInterval(heartbeat));

  // Max-age sweep: expire queued requests older than maxAgeMs that are unclaimed
  // or offline, so the durable inbox — and any grants an auto-resume could
  // re-arm — never lingers indefinitely. Runs at most every 5 minutes.
  const SWEEP_MS = Math.max(1_000, Math.min(maxAgeMs, 5 * 60_000));
  const sweep = setInterval(() => {
    const cutoff = Date.now() - maxAgeMs;
    for (const id of store.expireBefore(cutoff)) {
      endSession(id, "request expired (max age reached)", {
        agent: true,
        expert: true,
      });
    }
  }, SWEEP_MS);
  sweep.unref?.();
  server.on("close", () => clearInterval(sweep));

  function sendTo(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  // Constant-time token comparison: plain string `===` short-circuits at the
  // first differing byte, leaking a timing side channel against the bearer
  // tokens that gate a session.
  function tokenEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  // Per-socket token bucket for chat messages. Bounds the CPU (redaction) and
  // fan-out cost an authenticated socket can impose, on both the customer and
  // expert sides. Silently drops over-limit messages (no error frame, so a
  // flood can't be amplified into a reply flood).
  const CHAT_BURST = 20; // messages...
  const CHAT_WINDOW_MS = 10_000; // ...per rolling window
  const chatRate = new WeakMap<WebSocket, { count: number; windowStart: number }>();
  function allowChat(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = chatRate.get(ws);
    if (!bucket || now - bucket.windowStart >= CHAT_WINDOW_MS) {
      chatRate.set(ws, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= CHAT_BURST) return false;
    bucket.count += 1;
    return true;
  }

  function queueEntry(session: Session) {
    return {
      sessionId: session.id,
      customerName: session.customerName,
      projectDir: session.projectDir,
      issue: session.issue,
      status: session.status,
      // Whether the customer's machine is currently connected. Offline requests
      // stay in the queue (durable inbox) and reconnect when the machine returns.
      online: session.online,
      expertName: session.expertName,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      claimedAt: session.claimedAt,
      permissions: session.permissions,
      activityCount: session.activity.length,
    };
  }

  function broadcastQueue(): void {
    const sessions = store.queue().map(queueEntry);
    for (const ws of experts.keys()) {
      sendTo(ws, { type: "queue", sessions });
    }
  }

  function expertFor(sessionId: string): WebSocket | undefined {
    for (const [ws, conn] of experts) {
      // Skip a claimed-but-dead socket. After a dashboard reconnect the old
      // socket lingers in the map until its close fires; routing the agent's
      // answer to it — or treating it as "already live" during reattach, which
      // would strand the new socket with an empty claim set and drop its
      // signals — breaks the handshake. Only ever return an OPEN socket.
      if (conn.claimed.has(sessionId) && ws.readyState === ws.OPEN) return ws;
    }
    return undefined;
  }

  /** Send a message to every customer chat socket of a session. */
  function notifyChatSockets(sessionId: string, msg: unknown): void {
    for (const ws of chatSockets.get(sessionId) ?? []) {
      sendTo(ws, msg);
    }
  }

  /**
   * Redact, store, and fan out an accepted chat message. Echo rule: every
   * accepted message goes to ALL customer chat sockets of the session AND to
   * the claiming expert — including whoever sent it. UIs never render
   * optimistically; the echo is the single render path.
   */
  function acceptChat(
    sessionId: string,
    from: ChatMessage["from"],
    name: string,
    rawText: string,
  ): void {
    const { text } = redactText(rawText);
    const message: ChatMessage = { at: Date.now(), from, name, text };
    store.addChat(sessionId, message);
    notifyChatSockets(sessionId, { type: "chat", message });
    const expertWs = expertFor(sessionId);
    if (expertWs) sendTo(expertWs, { type: "chat", sessionId, message });
  }

  /**
   * Fan an accepted issue edit out to everyone who cares: the customer's agent
   * (so it rebuilds CONTEXT.md), the claiming expert, and every customer chat
   * socket (including the editor, since the echo is the single render path). The
   * issue is already redacted by the time it is stored.
   */
  function broadcastIssueUpdated(session: Session): void {
    const payload = {
      type: "issue-updated",
      issue: session.issue ?? "",
      by: session.issueEditedBy,
      at: session.issueEditedAt,
    };
    const agentWs = agents.get(session.id);
    if (agentWs) sendTo(agentWs, payload);
    const expertWs = expertFor(session.id);
    if (expertWs) sendTo(expertWs, payload);
    notifyChatSockets(session.id, payload);
  }

  function endSession(sessionId: string, reason: string | undefined, notify: {
    agent?: boolean;
    expert?: boolean;
  }): void {
    // An explicit end wins over any pending grace-expiry release.
    clearAgentGrace(sessionId);
    clearExpertGrace(sessionId);
    const session = store.end(sessionId, reason);
    if (!session) return;
    const durationMs = (session.endedAt ?? Date.now()) - session.createdAt;
    if (notify.agent) {
      const agentWs = agents.get(sessionId);
      if (agentWs) sendTo(agentWs, { type: "session-ended", sessionId, reason, durationMs });
    }
    if (notify.expert) {
      const expertWs = expertFor(sessionId);
      if (expertWs) {
        sendTo(expertWs, { type: "session-ended", sessionId, reason, durationMs });
        experts.get(expertWs)?.claimed.delete(sessionId);
      }
    }
    notifyChatSockets(sessionId, { type: "session-ended", reason });
    // Close the customer chat sockets so the relay doesn't hold a Set entry
    // (pinged every heartbeat) for a permanently-ended session while a walked-
    // away customer's tab stays open. The session-ended frame above is queued
    // before the close frame, so clients still render the ended state.
    for (const cs of chatSockets.get(sessionId) ?? []) cs.close(4410, "session ended");
    chatSockets.delete(sessionId);
    agents.delete(sessionId);
    // An explicit end is the one path that truly deletes the durable record.
    void persistence.remove(sessionId).catch((err) =>
      log(`persist remove failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`),
    );
    log(`session ${sessionId} ended (${Math.round(durationMs / 1000)}s)`);
    broadcastQueue();
  }

  /* ── Agent connections (customer machine) ─────────────────────── */

  function handleAgent(ws: WebSocket): void {
    let sessionId: string | undefined;

    ws.on("message", (raw) => {
      const msg = parseMessage<AgentMessage>(raw, agentMessageSchema);
      if (!msg) {
        ws.close(1002, "invalid message");
        return;
      }
      if (!sessionId) {
        // Rejoin an existing queued request (reconnect / process restart).
        if (msg.type === "resume") {
          const existing = store.get(msg.sessionId);
          const valid =
            existing !== undefined &&
            existing.status !== "ended" &&
            tokenEquals(
              existing.resumeTokenHash,
              hashResumeToken(msg.resumeToken),
            );
          if (!valid) {
            // Stay unregistered so the client can fall back to a fresh register
            // on this same socket without a reconnect round-trip.
            sendTo(ws, {
              type: "resume-failed",
              reason: "unknown or expired session",
            });
            return;
          }
          sessionId = existing.id;
          agents.set(sessionId, ws);
          // Back within the grace window: the claim was never released, the
          // expert never notified — the blip stays invisible.
          clearAgentGrace(sessionId);
          const back = store.setOnline(sessionId, true);
          sendTo(ws, {
            type: "resumed",
            sessionId,
            status: back.status,
            expertName: back.expertName,
            permissions: back.permissions,
          });
          persist(back);
          log(`session ${sessionId} resumed (customer back online)`);
          broadcastQueue();
          return;
        }
        if (msg.type !== "register") {
          ws.close(1002, "must register first");
          return;
        }
        const { session, resumeToken } = store.create({
          customerName: msg.customerName,
          projectDir: msg.projectDir,
          issue: msg.issue,
          contextManifest: msg.contextManifest,
        });
        sessionId = session.id;
        agents.set(sessionId, ws);
        sendTo(ws, {
          type: "registered",
          sessionId,
          customerToken: session.customerToken,
          // Returned once; the agent persists it to resume after a restart.
          resumeToken,
        });
        persist(session);
        log(`session ${sessionId} registered for ${msg.customerName}`);
        broadcastQueue();
        return;
      }

      switch (msg.type) {
        case "register":
        case "resume":
          ws.close(1002, "already registered");
          return;
        case "metadata": {
          if (msg.permissions) {
            const updated = store.setPermissions(sessionId, msg.permissions);
            // Persist scope changes (not every activity line) so a relay restart
            // keeps the latest grants for auto-resume.
            persist(updated);
          }
          if (msg.activity) {
            const updated = store.addActivity(sessionId, msg.activity);
            // Fan the action out to the customer's chat page too, so they can
            // watch what the expert is doing in real time — not just experts.
            const entry = updated.activity[updated.activity.length - 1];
            if (entry) notifyChatSockets(sessionId, { type: "activity", entry });
          }
          broadcastQueue();
          return;
        }
        case "signal": {
          const expertWs = expertFor(sessionId);
          if (expertWs) {
            sendTo(expertWs, { type: "signal", sessionId, payload: msg.payload });
          }
          return;
        }
        case "end":
          endSession(sessionId, msg.reason, { expert: true });
          return;
      }
    });

    ws.on("close", () => {
      if (!sessionId) return;
      // Ignore a superseded socket. If the agent already reconnected (a resume
      // set a newer socket for this session), this stale close — which can fire
      // up to ~2min late on the heartbeat — must NOT delete the live mapping or
      // mark the session offline. Only the socket that currently owns the
      // session may run the offline/grace path.
      if (agents.get(sessionId) !== ws) return;
      const session = store.get(sessionId);
      if (!session || session.status === "ended") return;
      // The core of the durable inbox: a dropped customer socket no longer ends
      // the request. Keep it in the queue, just mark the machine offline; it
      // reconnects (resume) when the machine is back.
      store.setOnline(sessionId, false);
      agents.delete(sessionId);
      if (session.status === "active" && !agentGrace.has(sessionId)) {
        // Customer's relay socket dropped mid-session — but the WebRTC peer is
        // independent of this socket and usually still alive (the expert may
        // be typing in the terminal right now). Hold the claim for a grace
        // window; only if the agent doesn't resume in time is the claim
        // released and everyone told.
        const id = sessionId;
        const timer = setTimeout(() => {
          agentGrace.delete(id);
          const s = store.get(id);
          if (!s || s.status !== "active" || s.online) return;
          store.release(id);
          persist(store.get(id));
          const expertWs = expertFor(id);
          if (expertWs) {
            sendTo(expertWs, {
              type: "session-ended",
              sessionId: id,
              reason:
                "Customer went offline — the request is back in the queue and will reconnect when they return.",
            });
            experts.get(expertWs)?.claimed.delete(id);
          }
          notifyChatSockets(id, { type: "expert-left" });
          broadcastQueue();
          log(`session ${id} released (customer offline past grace)`);
        }, activeGraceMs);
        timer.unref?.();
        agentGrace.set(id, timer);
      }
      persist(store.get(sessionId));
      log(`session ${sessionId} offline (customer disconnected)`);
      broadcastQueue();
    });
  }

  /* ── Expert connections (dashboard) ───────────────────────────── */

  function handleExpert(ws: WebSocket): void {
    const authTimer = setTimeout(() => ws.close(4401, "auth timeout"), AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      const msg = parseMessage<ExpertMessage>(raw, expertMessageSchema);
      if (!msg) {
        ws.close(1002, "invalid message");
        return;
      }
      const conn = experts.get(ws);

      if (!conn) {
        if (msg.type !== "auth" || !options.expertTokens.some((t) => tokenEquals(t, msg.token))) {
          sendTo(ws, { type: "auth-failed" });
          ws.close(4401, "auth failed");
          return;
        }
        clearTimeout(authTimer);
        // Roster identity (ours) resolves the display name; the reattach loop
        // (origin/main) rebinds sessions dropped during a socket blip. They
        // compose: build the connection with the profile, then reattach using
        // the RESOLVED name, which is what was stored on the session at claim.
        const profile = msg.expertId ? findExpert(msg.expertId) : undefined;
        const fresh: ExpertConn = {
          name: profile?.name ?? msg.name,
          profile,
          claimed: new Set(),
        };
        experts.set(ws, fresh);
        // Re-attach active sessions this expert dropped within grace: the P2P
        // work never stopped, only the signaling socket needed rebinding.
        // Only sessions in expertGrace are eligible — a session is in the grace
        // map ONLY after its expert socket closed, so this can never rebind a
        // session whose expert is still live (that's the hijack guard). It's
        // still their OWN session (name match + reattach refuses anything else).
        for (const sessionId of [...expertGrace.keys()]) {
          const s = store.get(sessionId);
          if (s?.status !== "active" || s.expertName !== fresh.name) continue;
          if (expertFor(sessionId)) continue; // someone already live on it
          clearExpertGrace(sessionId);
          store.reattach(sessionId, fresh.name);
          fresh.claimed.add(sessionId);
          // Silent rebind: the dashboard's RTCPeerConnection is independent of
          // this signaling socket and survives the blip, so we do NOT force a
          // re-handshake (that would tear down a healthy peer). Signaling just
          // resumes on the new socket. The agent is never told anything changed.
          log(`expert ${fresh.name} re-attached to session ${sessionId}`);
        }
        sendTo(ws, { type: "auth-ok", name: fresh.name, expert: profile });
        sendTo(ws, { type: "queue", sessions: store.queue().map(queueEntry) });
        log(`expert ${fresh.name} connected`);
        return;
      }

      switch (msg.type) {
        case "auth":
          return; // already authed
        case "claim": {
          // A request whose machine is offline can't establish the WebRTC peer,
          // so it isn't claimable until the customer reconnects.
          if (store.get(msg.sessionId)?.online === false) {
            sendTo(ws, {
              type: "claim-failed",
              sessionId: msg.sessionId,
              reason:
                "Customer is offline — the request stays in the queue and becomes claimable when they reconnect.",
            });
            return;
          }
          try {
            store.claim(msg.sessionId, conn.name, conn.profile?.id);
          } catch (err) {
            sendTo(ws, {
              type: "claim-failed",
              sessionId: msg.sessionId,
              reason: err instanceof Error ? err.message : "claim failed",
            });
            return;
          }
          // Claiming a (waiting) session drops any stale expert-drop grace
          // timer left over from a prior claimant, so it can't fire later.
          clearExpertGrace(msg.sessionId);
          conn.claimed.add(msg.sessionId);
          persist(store.get(msg.sessionId));
          sendTo(ws, { type: "claimed", sessionId: msg.sessionId });
          sendTo(ws, {
            type: "chat-history",
            sessionId: msg.sessionId,
            messages: store.get(msg.sessionId)?.chat ?? [],
          });
          const agentWs = agents.get(msg.sessionId);
          if (agentWs) {
            sendTo(agentWs, {
              type: "expert-joined",
              expertName: conn.name,
              expert: conn.profile,
            });
          }
          notifyChatSockets(msg.sessionId, {
            type: "expert-joined",
            expertName: conn.name,
            expert: conn.profile,
          });
          broadcastQueue();
          return;
        }
        case "release": {
          if (!conn.claimed.delete(msg.sessionId)) return;
          if (store.get(msg.sessionId)?.status === "active") {
            store.release(msg.sessionId);
            persist(store.get(msg.sessionId));
            const agentWs = agents.get(msg.sessionId);
            if (agentWs) sendTo(agentWs, { type: "expert-left" });
            notifyChatSockets(msg.sessionId, { type: "expert-left" });
          }
          broadcastQueue();
          return;
        }
        case "signal": {
          if (!conn.claimed.has(msg.sessionId)) return; // not yours to signal
          const agentWs = agents.get(msg.sessionId);
          if (agentWs) sendTo(agentWs, { type: "signal", payload: msg.payload });
          return;
        }
        case "chat": {
          if (!conn.claimed.has(msg.sessionId)) return; // not yours to chat in
          if (store.get(msg.sessionId)?.status !== "active") return;
          if (!allowChat(ws)) return; // rate limited
          acceptChat(msg.sessionId, "expert", conn.name, msg.text);
          return;
        }
        case "end-session": {
          if (!conn.claimed.has(msg.sessionId)) return;
          conn.claimed.delete(msg.sessionId);
          endSession(msg.sessionId, msg.reason, { agent: true });
          return;
        }
        case "edit-issue": {
          if (!conn.claimed.has(msg.sessionId)) return; // not yours to edit
          const session = store.get(msg.sessionId);
          if (!session || session.status !== "active") return;
          if (!allowChat(ws)) return; // rate limited (shares the chat bucket)
          // Customer always wins: reject an expert edit whose baseAt predates
          // the customer's most recent edit. A missing baseAt against a live
          // customer edit is treated as stale (the expert can't prove they saw
          // it). Expert-over-expert and edits on a fresh issue are last-write-wins.
          const stale =
            session.issueEditedBy === "customer" &&
            session.issueEditedAt !== undefined &&
            (msg.baseAt === undefined || msg.baseAt < session.issueEditedAt);
          if (stale) {
            sendTo(ws, {
              type: "edit-rejected",
              reason:
                "The customer updated this while you were editing; here is their version.",
              issue: session.issue ?? "",
              at: session.issueEditedAt,
              by: session.issueEditedBy,
            });
            return;
          }
          const { text } = redactText(msg.text);
          const updated = store.setIssue(msg.sessionId, text, "expert");
          persist(updated);
          broadcastIssueUpdated(updated);
          return;
        }
        case "deliver": {
          if (!conn.claimed.has(msg.sessionId)) return; // not yours to deliver
          const session = store.get(msg.sessionId);
          if (!session || session.status !== "active") return;
          if (!allowChat(ws)) return; // rate limited (shares the chat bucket)
          // Redact the summary the same way as chat: the customer reads it word
          // for word, so a stray secret in it must not reach them.
          const { text } = redactText(msg.summary);
          const updated = store.setDelivery(msg.sessionId, text);
          persist(updated);
          const at = updated.delivery?.at ?? Date.now();
          const payload = { type: "delivered", summary: text, at };
          notifyChatSockets(msg.sessionId, payload);
          const agentWs = agents.get(msg.sessionId);
          if (agentWs) sendTo(agentWs, payload);
          return;
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      const conn = experts.get(ws);
      experts.delete(ws);
      if (!conn) return;
      for (const sessionId of conn.claimed) {
        if (store.get(sessionId)?.status !== "active") continue;
        if (expertGrace.has(sessionId)) continue;
        // Expert's relay socket dropped mid-session — the P2P peer usually
        // survives the blip, and the dashboard re-auths on reconnect. Hold
        // the claim for a grace window (re-attached on auth by name, or via
        // an explicit re-claim); release only if they stay gone.
        const timer = setTimeout(() => {
          expertGrace.delete(sessionId);
          const s = store.get(sessionId);
          if (!s || s.status !== "active") return;
          if (expertFor(sessionId)) return; // re-attached meanwhile
          store.release(sessionId);
          persist(store.get(sessionId));
          const agentWs = agents.get(sessionId);
          if (agentWs) sendTo(agentWs, { type: "expert-left" });
          notifyChatSockets(sessionId, { type: "expert-left" });
          broadcastQueue();
          log(`session ${sessionId} released (expert offline past grace)`);
        }, activeGraceMs);
        timer.unref?.();
        expertGrace.set(sessionId, timer);
      }
      log(`expert ${conn.name} disconnected`);
    });
  }

  /* ── Customer chat connections (chat page) ────────────────────── */

  function handleCustomer(ws: WebSocket): void {
    // Mirror the expert auth pattern: hello must arrive quickly or we drop.
    const helloTimer = setTimeout(
      () => ws.close(4401, "hello timeout"),
      AUTH_TIMEOUT_MS,
    );
    let sessionId: string | undefined;

    ws.on("message", (raw) => {
      const msg = parseMessage<CustomerMessage>(raw, customerMessageSchema);
      if (!msg) {
        ws.close(1002, "invalid message");
        return;
      }

      if (!sessionId) {
        if (msg.type !== "hello") {
          ws.close(1002, "must hello first");
          return;
        }
        const session = store.get(msg.sessionId);
        if (!session || !tokenEquals(session.customerToken, msg.token)) {
          sendTo(ws, { type: "hello-failed" });
          ws.close(4401, "hello failed");
          return;
        }
        clearTimeout(helloTimer);
        sessionId = session.id;
        let sockets = chatSockets.get(sessionId);
        if (!sockets) {
          sockets = new Set();
          chatSockets.set(sessionId, sockets);
        }
        sockets.add(ws);
        sendTo(ws, {
          type: "hello-ok",
          status: session.status,
          expertName: session.expertName,
          history: session.chat,
          // Seed the live activity feed for a customer who opens (or reopens)
          // the page after the expert has already started working.
          activity: session.activity.slice(-50),
          // Expert card when claimed, the full bench always, and the granted
          // scopes + current issue so a reload restores the whole chat state.
          expert: session.expertId ? findExpert(session.expertId) : undefined,
          bench: ROSTER,
          permissions: session.permissions,
          issue: session.issue,
          issueEditedAt: session.issueEditedAt,
          issueEditedBy: session.issueEditedBy,
          contextManifest: session.contextManifest,
          // The whole delivery record, so a reload restores the delivered card
          // (unresponded) or the accepted screen (accepted).
          delivery: session.delivery,
        });
        log(`customer chat socket joined session ${sessionId}`);
        return;
      }

      switch (msg.type) {
        case "hello":
          ws.close(1002, "already helloed");
          return;
        case "chat": {
          const session = store.get(sessionId);
          if (!session) return; // session gone — refuse silently
          if (session.status === "ended") {
            sendTo(ws, { type: "session-ended" });
            return;
          }
          if (!allowChat(ws)) return; // rate limited
          acceptChat(sessionId, "customer", session.customerName, msg.text);
          return;
        }
        case "edit-issue": {
          const session = store.get(sessionId);
          if (!session || session.status === "ended") return; // gone/ended: refuse silently
          if (!allowChat(ws)) return; // rate limited (shares the chat bucket)
          // Customer edits are never rejected; they set the new baseline that a
          // concurrent expert edit is measured against.
          const { text } = redactText(msg.text);
          const updated = store.setIssue(sessionId, text, "customer");
          persist(updated);
          broadcastIssueUpdated(updated);
          return;
        }
        case "delivery-response": {
          const session = store.get(sessionId);
          if (!session || session.status !== "active") return;
          if (!allowChat(ws)) return; // rate limited (shares the chat bucket)
          let updated: Session;
          try {
            updated = store.respondDelivery(sessionId, msg.accepted);
          } catch {
            return; // no delivery / already responded: ignore silently
          }
          // Accepting does NOT end the session or revoke access (decision
          // 2026-07-17). Just persist the outcome and fan it out.
          persist(updated);
          const at = updated.delivery?.respondedAt ?? Date.now();
          const payload = {
            type: msg.accepted ? "delivery-accepted" : "delivery-declined",
            at,
          };
          const agentWs = agents.get(sessionId);
          if (agentWs) sendTo(agentWs, payload);
          const expertWs = expertFor(sessionId);
          if (expertWs) sendTo(expertWs, payload);
          notifyChatSockets(sessionId, payload);
          return;
        }
        case "rate": {
          const session = store.get(sessionId);
          if (!session || session.status !== "active") return;
          if (!allowChat(ws)) return; // rate limited (shares the chat bucket)
          try {
            store.setRating(sessionId, msg.rating);
          } catch {
            return; // rate before accept / double-rate: ignore silently
          }
          // The rating is a fire-once event to the claiming expert only: never
          // persisted, never aggregated, never shown to other chat sockets
          // (decision 2026-07-17).
          const expertWs = expertFor(sessionId);
          if (expertWs) sendTo(expertWs, { type: "rated", rating: msg.rating });
          return;
        }
        case "end": {
          // The customer ends their own session: same fan-out and teardown as an
          // expert end-session (agent + claiming expert + all chat sockets get
          // session-ended; store.end + persistence removal).
          endSession(sessionId, "customer ended the session", {
            agent: true,
            expert: true,
          });
          return;
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (!sessionId) return;
      const sockets = chatSockets.get(sessionId);
      if (!sockets) return;
      sockets.delete(ws);
      if (sockets.size === 0) chatSockets.delete(sessionId);
    });
  }

  /** Load persisted requests back into the queue. Call once before listen(). */
  async function hydrate(): Promise<void> {
    try {
      const restored = await persistence.loadAll();
      for (const s of restored) store.hydrate(s);
      if (restored.length > 0) {
        log(`restored ${restored.length} queued request(s) from durable storage`);
        broadcastQueue();
      }
    } catch (err) {
      log(`hydrate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { server, store, hydrate };
}
