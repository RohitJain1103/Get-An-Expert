import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  agentMessageSchema,
  expertMessageSchema,
  parseMessage,
  type AgentMessage,
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

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: store.queue().length }));
      return;
    }
    if (options.dashboardDir) {
      serveStatic(options.dashboardDir, req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://relay.local").pathname;
    if (path !== "/agent" && path !== "/expert") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (path === "/agent") handleAgent(ws);
      else handleExpert(ws);
    });
  });

  function sendTo(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
        sendTo(ws, { type: "registered", sessionId });
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
          if (msg.activity) store.addActivity(sessionId, msg.activity);
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
        if (msg.type !== "auth" || !options.expertTokens.includes(msg.token)) {
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
          const agentWs = agents.get(msg.sessionId);
          if (agentWs) {
            sendTo(agentWs, { type: "expert-joined", expertName: conn.name });
          }
          broadcastQueue();
          return;
        }
        case "release": {
          if (!conn.claimed.delete(msg.sessionId)) return;
          if (store.get(msg.sessionId)?.status === "active") {
            store.release(msg.sessionId);
            const agentWs = agents.get(msg.sessionId);
            if (agentWs) sendTo(agentWs, { type: "expert-left" });
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
        }
      }
      if (conn.claimed.size > 0) broadcastQueue();
      log(`expert ${conn.name} disconnected`);
    });
  }

  return { server, store };
}
