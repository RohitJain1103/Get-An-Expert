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
import { SessionStore, type Session } from "./sessions";
import { serveStatic } from "./static";

export interface RelayOptions {
  /** Tokens that authenticate experts. */
  expertTokens: string[];
  /** Directory of dashboard static files; omit to disable static serving. */
  dashboardDir?: string;
  /** Called for operational logging. Never receives signal payloads. */
  log?: (line: string) => void;
}

export interface Relay {
  server: Server;
  store: SessionStore;
}

interface ExpertConn {
  name: string;
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
  const agents = new Map<string, WebSocket>(); // sessionId -> agent socket
  const experts = new Map<WebSocket, ExpertConn>(); // authed experts
  const chatSockets = new Map<string, Set<WebSocket>>(); // sessionId -> customer chat sockets

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: store.queue().length }));
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
  const alive = new WeakSet<WebSocket>();
  function trackHeartbeat(ws: WebSocket): void {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  }
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  server.on("close", () => clearInterval(heartbeat));

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
      expertName: session.expertName,
      createdAt: session.createdAt,
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
      if (conn.claimed.has(sessionId)) return ws;
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

  function endSession(sessionId: string, reason: string | undefined, notify: {
    agent?: boolean;
    expert?: boolean;
  }): void {
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
        if (msg.type !== "register") {
          ws.close(1002, "must register first");
          return;
        }
        const session = store.create({
          customerName: msg.customerName,
          projectDir: msg.projectDir,
          issue: msg.issue,
        });
        sessionId = session.id;
        agents.set(sessionId, ws);
        sendTo(ws, {
          type: "registered",
          sessionId,
          customerToken: session.customerToken,
        });
        log(`session ${sessionId} registered for ${msg.customerName}`);
        broadcastQueue();
        return;
      }

      switch (msg.type) {
        case "register":
          ws.close(1002, "already registered");
          return;
        case "metadata": {
          if (msg.permissions) store.setPermissions(sessionId, msg.permissions);
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
      if (sessionId && store.get(sessionId)?.status !== "ended") {
        endSession(sessionId, "customer disconnected", { expert: true });
      }
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
        experts.set(ws, { name: msg.name, claimed: new Set() });
        sendTo(ws, { type: "auth-ok", name: msg.name });
        sendTo(ws, { type: "queue", sessions: store.queue().map(queueEntry) });
        log(`expert ${msg.name} connected`);
        return;
      }

      switch (msg.type) {
        case "auth":
          return; // already authed
        case "claim": {
          try {
            store.claim(msg.sessionId, conn.name);
          } catch (err) {
            sendTo(ws, {
              type: "claim-failed",
              sessionId: msg.sessionId,
              reason: err instanceof Error ? err.message : "claim failed",
            });
            return;
          }
          conn.claimed.add(msg.sessionId);
          sendTo(ws, { type: "claimed", sessionId: msg.sessionId });
          sendTo(ws, {
            type: "chat-history",
            sessionId: msg.sessionId,
            messages: store.get(msg.sessionId)?.chat ?? [],
          });
          const agentWs = agents.get(msg.sessionId);
          if (agentWs) {
            sendTo(agentWs, { type: "expert-joined", expertName: conn.name });
          }
          notifyChatSockets(msg.sessionId, {
            type: "expert-joined",
            expertName: conn.name,
          });
          broadcastQueue();
          return;
        }
        case "release": {
          if (!conn.claimed.delete(msg.sessionId)) return;
          if (store.get(msg.sessionId)?.status === "active") {
            store.release(msg.sessionId);
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
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      const conn = experts.get(ws);
      experts.delete(ws);
      if (!conn) return;
      for (const sessionId of conn.claimed) {
        if (store.get(sessionId)?.status === "active") {
          store.release(sessionId);
          const agentWs = agents.get(sessionId);
          if (agentWs) sendTo(agentWs, { type: "expert-left" });
          notifyChatSockets(sessionId, { type: "expert-left" });
        }
      }
      if (conn.claimed.size > 0) broadcastQueue();
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

  return { server, store };
}
