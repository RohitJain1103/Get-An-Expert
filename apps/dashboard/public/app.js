// Get An Expert expert dashboard.
//
// Connects to the relay (WebSocket) for signaling and session metadata, then
// establishes a peer-to-peer WebRTC data channel to the customer's agent and
// speaks MCP over it. The relay only shuttles the signaling handshake — every
// file read, command, and screenshot travels directly to the customer's
// machine and never touches the relay.

import { MiniMcpClient } from "./mcp-client.js";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const el = (id) => document.getElementById(id);

const state = {
  ws: null,
  expertName: "",
  sessions: new Map(), // sessionId -> queue entry
  activeId: null,
  pc: null,
  dc: null,
  dcPty: null,
  mcp: null,
  term: null,
  fit: null,
  ptyResize: null,
};

/* ── Connect gate ─────────────────────────────────────────────────── */

el("connect-btn").addEventListener("click", connect);
el("expert-token").addEventListener("keydown", (e) => {
  if (e.key === "Enter") connect();
});

function connect() {
  const url = el("relay-url").value.trim().replace(/^http/, "ws").replace(/\/+$/, "");
  const token = el("expert-token").value.trim();
  const name = el("expert-name").value.trim();
  el("gate-error").textContent = "";
  if (!token || !name) {
    el("gate-error").textContent = "Enter your token and name.";
    return;
  }
  state.expertName = name;
  setConn("connecting", "Connecting…");

  let ws;
  try {
    ws = new WebSocket(`${url}/expert`);
  } catch (err) {
    el("gate-error").textContent = `Bad relay URL: ${err.message}`;
    setConn("error", "Failed");
    return;
  }
  state.ws = ws;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "auth", token, name }));
  });
  ws.addEventListener("message", (ev) => handleRelay(JSON.parse(ev.data)));
  ws.addEventListener("error", () => {
    el("gate-error").textContent = "Could not reach the relay.";
    setConn("error", "Error");
  });
  ws.addEventListener("close", () => {
    setConn("offline", "Disconnected");
  });
}

function setConn(kind, label) {
  const dot = el("conn-dot");
  dot.className = "conn-dot" + (kind === "online" ? " online" : kind === "error" ? " error" : "");
  el("conn-label").textContent = label;
}

/* ── Relay protocol ───────────────────────────────────────────────── */

function relaySend(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function handleRelay(msg) {
  switch (msg.type) {
    case "auth-ok":
      setConn("online", `Connected as ${state.expertName}`);
      el("gate").classList.add("hidden");
      el("app").classList.remove("hidden");
      break;
    case "auth-failed":
      el("gate-error").textContent = "Authentication failed. Check your token.";
      setConn("error", "Auth failed");
      break;
    case "queue":
      updateQueue(msg.sessions);
      break;
    case "claimed":
      onClaimed(msg.sessionId);
      break;
    case "claim-failed":
      status(`Could not claim session: ${msg.reason}`);
      break;
    case "signal":
      handleSignal(msg.payload);
      break;
    case "session-ended":
      onSessionEnded(msg.sessionId, msg.reason, msg.durationMs);
      break;
  }
}

/* ── Queue ────────────────────────────────────────────────────────── */

function updateQueue(sessions) {
  state.sessions = new Map(sessions.map((s) => [s.sessionId, s]));
  const list = el("queue-list");
  list.innerHTML = "";
  el("queue-empty").classList.toggle("hidden", sessions.length > 0);

  for (const s of sessions) {
    const mine = s.status === "active" && s.expertName === state.expertName;
    const takenByOther = s.status === "active" && !mine;
    const div = document.createElement("div");
    div.className = "queue-item" + (s.sessionId === state.activeId ? " active" : "");
    const statusClass = mine ? "active" : takenByOther ? "taken" : "waiting";
    const statusText = mine ? "Active (you)" : takenByOther ? `With ${escapeHtml(s.expertName)}` : "Waiting";
    div.innerHTML = `
      <div class="qname">${escapeHtml(s.customerName)}</div>
      <div class="qproject">${escapeHtml(s.projectDir)}</div>
      ${s.issue ? `<div class="qissue">${escapeHtml(s.issue)}</div>` : ""}
      <div class="qstatus ${statusClass}">${statusText}</div>`;
    if (!takenByOther) {
      div.addEventListener("click", () => {
        if (mine || s.sessionId === state.activeId) openWorkspace(s);
        else claimSession(s.sessionId);
      });
    }
    list.appendChild(div);
  }

  // Refresh permission chips if the active session's metadata changed.
  if (state.activeId && state.sessions.has(state.activeId)) {
    renderPerms(state.sessions.get(state.activeId));
  }
}

function claimSession(sessionId) {
  state.activeId = sessionId;
  relaySend({ type: "claim", sessionId });
}

function onClaimed(sessionId) {
  const session = state.sessions.get(sessionId);
  if (session) openWorkspace({ ...session, status: "active", expertName: state.expertName });
  startWebRTC(sessionId);
}

/* ── Workspace UI ─────────────────────────────────────────────────── */

function openWorkspace(session) {
  state.activeId = session.sessionId;
  el("ws-idle").classList.add("hidden");
  el("ws-active").classList.remove("hidden");
  el("ws-body").classList.remove("hidden");
  el("ws-title").textContent = `${session.customerName} — ${session.projectDir}`;
  el("term-dir").textContent = session.projectDir;
  renderPerms(session);
}

function renderPerms(session) {
  const p = session.permissions || { files: false, terminal: false, browser: false };
  const chip = (on, label) => `<span class="perm-chip ${on ? "on" : "off"}">${label}</span>`;
  el("ws-perms").innerHTML =
    chip(p.files, "Files") +
    chip(p.terminal, "Terminal") +
    chip(p.browser, p.browserPort ? `Browser :${p.browserPort}` : "Browser");
}

/* ── WebRTC (browser is the offerer) ──────────────────────────────── */

async function startWebRTC(sessionId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;
  // Two channels: MCP (files/browser tools) and the interactive PTY terminal.
  const dcMcp = pc.createDataChannel("mcp");
  const dcPty = pc.createDataChannel("pty");
  state.dc = dcMcp;
  state.dcPty = dcPty;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      relaySend({
        type: "signal",
        sessionId,
        payload: { kind: "candidate", candidate: e.candidate.candidate, mid: e.candidate.sdpMid },
      });
    }
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      status(`Peer connection ${pc.connectionState}.`);
    }
  };

  dcMcp.onopen = () => initMcp(dcMcp);
  dcMcp.onclose = () => state.mcp?.fail("data channel closed");
  dcPty.onopen = () => initPty(dcPty);

  status("Establishing a direct connection to the customer's machine…");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  relaySend({
    type: "signal",
    sessionId,
    payload: { kind: "description", sdp: pc.localDescription.sdp, sdpType: pc.localDescription.type },
  });
}

async function handleSignal(payload) {
  const pc = state.pc;
  if (!pc || !payload) return;
  try {
    if (payload.kind === "description") {
      await pc.setRemoteDescription({ type: payload.sdpType, sdp: payload.sdp });
    } else if (payload.kind === "candidate" && payload.candidate) {
      await pc.addIceCandidate({ candidate: payload.candidate, sdpMid: payload.mid ?? undefined });
    }
  } catch (err) {
    status(`Signaling error: ${err.message}`);
  }
}

/* ── MCP over the data channel ────────────────────────────────────── */

async function initMcp(dc) {
  const mcp = new MiniMcpClient((raw) => dc.send(raw));
  state.mcp = mcp;
  dc.onmessage = (ev) => mcp.feed(typeof ev.data === "string" ? ev.data : "");
  try {
    await mcp.initialize();
    await loadFiles();
  } catch (err) {
    status(`Failed to start MCP session: ${err.message}`);
  }
}

/* ── Interactive terminal (PTY over its own data channel) ──────────── */

function ptySend(msg) {
  if (state.dcPty && state.dcPty.readyState === "open") {
    state.dcPty.send(JSON.stringify(msg));
  }
}

function initPty(dc) {
  const term = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,monospace",
    cursorBlink: true,
    theme: { background: "#08080C", foreground: "#C8C8D2", cursor: "#F5A623", selectionBackground: "#33333d" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el("xterm"));
  fit.fit();
  state.term = term;
  state.fit = fit;

  status("Connected peer-to-peer. Interactive shell on the customer's machine — type below.");
  term.focus();

  // Expert keystrokes → shell on the customer's machine.
  term.onData((d) => ptySend({ t: "input", d }));

  // Shell output → terminal.
  dc.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === "data") term.write(m.d);
    else if (m.t === "denied") term.write(`\r\n\x1b[31mTerminal access not granted: ${m.reason}\x1b[0m\r\n`);
    else if (m.t === "exit") term.write(`\r\n\x1b[90m[terminal closed${m.reason ? ": " + m.reason : ""}]\x1b[0m\r\n`);
  };
  dc.onclose = () => term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");

  // Open the shell and keep it sized to the panel.
  ptySend({ t: "open", cols: term.cols, rows: term.rows });
  const onResize = () => { try { fit.fit(); ptySend({ t: "resize", cols: term.cols, rows: term.rows }); } catch { /* ignore */ } };
  state.ptyResize = onResize;
  window.addEventListener("resize", onResize);
}

function status(msg) {
  if (state.term) state.term.write(`\r\n\x1b[90m» ${msg}\x1b[0m\r\n`);
  else console.log("[get-an-expert]", msg);
}

/* ── Tool actions ─────────────────────────────────────────────────── */

el("refresh-files").addEventListener("click", loadFiles);

async function loadFiles() {
  if (!state.mcp) return;
  const res = await state.mcp.callTool("list_files", { dir: "." });
  const tree = el("file-tree");
  if (res.isError) {
    tree.innerHTML = `<div class="muted">${escapeHtml(res.text)}</div>`;
    return;
  }
  const payload = JSON.parse(res.text);
  tree.innerHTML = "";
  for (const entry of payload.entries) {
    const depth = entry.path.split("/").length - 1;
    const row = document.createElement("div");
    row.className = "file-row " + (entry.type === "dir" ? "dir" : "");
    row.style.paddingLeft = depth * 10 + "px";
    row.textContent = (entry.type === "dir" ? "▸ " : "") + entry.path.split("/").pop();
    if (entry.type === "file") row.addEventListener("click", () => openFile(entry.path));
    tree.appendChild(row);
  }
  if (payload.truncated) {
    const more = document.createElement("div");
    more.className = "muted";
    more.textContent = "…(truncated)";
    tree.appendChild(more);
  }
}

async function openFile(path) {
  if (!state.mcp) return;
  el("file-view-name").textContent = path;
  const res = await state.mcp.callTool("read_file", { path });
  const view = el("file-content");
  if (res.isError) {
    view.innerHTML = `<span class="muted">${escapeHtml(res.text)}</span>`;
    return;
  }
  const payload = JSON.parse(res.text);
  view.textContent = payload.content + (payload.truncated ? "\n…(truncated)" : "");
}

el("browser-refresh").addEventListener("click", captureBrowser);

async function captureBrowser() {
  if (!state.mcp) return;
  const card = el("browser-card");
  card.innerHTML = `<div class="muted">Capturing…</div>`;
  const shot = await state.mcp.callTool("browser_screenshot", {});
  if (shot.isError) {
    card.innerHTML = `<div class="muted">${escapeHtml(shot.text)}</div>`;
    return;
  }
  const p = JSON.parse(shot.text);

  // Console is a second, best-effort call so the network + console line matches
  // the real page state.
  let con = { entries: [], note: "" };
  try {
    const c = await state.mcp.callTool("browser_console", {});
    if (!c.isError) con = JSON.parse(c.text);
  } catch { /* ignore */ }

  const errors = (con.entries || []).filter((e) => e.level === "error").length;
  const n = (con.entries || []).length;
  const consoleLine = n === 0
    ? "Console: clean"
    : `Console: ${n} msg${n > 1 ? "s" : ""}${errors ? ` · ${errors} error${errors > 1 ? "s" : ""}` : ""}`;

  const visual = p.imageBase64
    ? `<img class="shot" alt="localhost:${p.port}" src="data:image/png;base64,${p.imageBase64}" title="Click to enlarge" />`
    : `<div class="browser-frame"><strong>${escapeHtml(p.title ?? "(no title)")}</strong><br /><span style="color:#666">localhost:${p.port}</span></div>`;

  card.innerHTML =
    visual +
    `<div class="browser-status ${p.ok ? "up" : "down"}">localhost:${p.port} · ${p.ok ? "HTTP " + (p.status ?? "?") : "unreachable"}</div>` +
    `<div class="browser-console ${errors ? "bad" : ""}">${consoleLine}</div>`;

  const img = card.querySelector(".shot");
  if (img) img.addEventListener("click", () => openShot(img.src, p));
}

function openShot(src, p) {
  const ov = document.createElement("div");
  ov.className = "shot-overlay";
  ov.innerHTML =
    `<div class="shot-box"><div class="shot-bar">localhost:${p.port} · ${p.title ? escapeHtml(p.title) + " · " : ""}HTTP ${p.status ?? "?"}<button class="shot-x">✕</button></div>` +
    `<img src="${src}" alt="localhost:${p.port} full" /></div>`;
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
}

el("end-btn").addEventListener("click", () => {
  if (!state.activeId) return;
  relaySend({ type: "end-session", sessionId: state.activeId, reason: "expert ended the session" });
});

function onSessionEnded(sessionId, reason, durationMs) {
  if (sessionId !== state.activeId) return;
  status(`Session ended (${reason ?? "done"}). Duration: ${formatDuration(durationMs)}. All access revoked.`);
  teardownPeer();
  state.activeId = null;
  el("ws-active").classList.add("hidden");
  el("ws-body").classList.add("hidden");
  el("ws-idle").classList.remove("hidden");
}

function teardownPeer() {
  state.mcp?.fail("session ended");
  state.mcp = null;
  if (state.ptyResize) window.removeEventListener("resize", state.ptyResize);
  state.ptyResize = null;
  try { state.term?.dispose(); } catch { /* ignore */ }
  state.term = null;
  state.fit = null;
  el("xterm").innerHTML = "";
  try { state.dcPty?.close(); } catch { /* ignore */ }
  try { state.dc?.close(); } catch { /* ignore */ }
  try { state.pc?.close(); } catch { /* ignore */ }
  state.dcPty = null;
  state.dc = null;
  state.pc = null;
}

/* ── utils ────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
