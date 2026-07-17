// Get An Expert expert dashboard.
//
// Connects to the relay (WebSocket) for signaling, session metadata, and the
// customer chat, then establishes a peer-to-peer WebRTC connection to the
// customer's agent: an "mcp" data channel for tools (files/browser) and one
// "pty"/"pty-N" data channel per terminal. The relay only shuttles the
// signaling handshake and chat — every file read, keystroke, and screenshot
// travels directly to the customer's machine and never touches the relay.
//
// Once a session is claimed the workspace is VS Code-shaped: a file-explorer
// sidebar (list_files), file tabs with markdown/HTML/code viewers (read_file,
// view-only by design), and a bottom panel with terminals, the browser
// screenshot tool, and the customer chat. Pure viewer logic (tree building,
// mode detection, tab state) lives in viewer.js as window.GaeViewer.

import { MiniMcpClient } from "./mcp-client.js";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const CHAT_MAX_CHARS = 2000;
const CHAT_MAX_RENDER = 500;
const HIGHLIGHT_MAX_CHARS = 200_000; // skip syntax highlighting above this

const el = (id) => document.getElementById(id);
const Viewer = window.GaeViewer;

const state = {
  ws: null,
  expertName: "",
  sessions: new Map(), // sessionId -> queue entry
  activeId: null,
  pc: null,
  dcMcp: null,
  mcp: null,
  // Bumped on every workspace reset; async tool results from a previous
  // session compare against it and drop themselves instead of rendering.
  sessionEpoch: 0,
  // Terminals: [{ id, title, label, dc, term, fit, host, exited }]
  terminals: [],
  termCounter: 0,
  activePanel: null, // "terminal:<id>" | "browser" | "chat"
  // File explorer + viewer.
  // The explorer is lazy: `fileEntries` accumulates only the directories the
  // expert has actually opened (one `list_files` level at a time), never the
  // whole recursive tree in one frame.
  fileEntries: [],
  listTruncated: false,
  expandedDirs: new Set(),
  loadedDirs: new Set(), // dirs whose children have been fetched
  loadingDirs: new Set(), // dirs with a fetch in flight (shows a spinner row)
  dirErrors: new Map(), // dir path -> error message from its last failed fetch
  tabState: Viewer.emptyTabState(),
  files: new Map(), // path -> { content, truncated } | { error }
  pendingReads: new Set(),
  renderPref: new Map(), // path -> "rendered" | "source"
  contextAutoOpened: false,
  // Chat
  chatMessages: [],
  chatUnread: 0,
};

/* ── Connect gate ─────────────────────────────────────────────────── */

// Default the Relay URL to wherever this dashboard is served from, so the
// expert never has to know it: ws://localhost:8787 when self-hosted locally,
// wss://<domain> when hosted (e.g. Railway). Only override the placeholder
// when actually served over http(s) (not opened as a file://).
if (location.protocol === "http:" || location.protocol === "https:") {
  el("relay-url").value = location.origin.replace(/^http/, "ws");
}

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
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return; // drop malformed relay frames
    }
    handleRelay(msg);
  });
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
      // Undo the optimistic claim so the queue entry stays clickable.
      if (msg.sessionId === state.activeId && !state.pc) state.activeId = null;
      status(`Could not claim session: ${msg.reason}`);
      break;
    case "signal":
      handleSignal(msg.payload);
      break;
    case "chat-history":
      onChatHistory(msg);
      break;
    case "chat":
      onChatMessage(msg);
      break;
    case "session-ended":
      onSessionEnded(msg.sessionId, msg.reason, msg.durationMs);
      break;
  }
}

/* ── Queue ────────────────────────────────────────────────────────── */

/** Compact "how long ago" for queue rows ("3m", "2h", "1d"). */
function relTime(iso) {
  const ms = Date.now() - (typeof iso === "number" ? iso : new Date(iso).getTime());
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function updateQueue(sessions) {
  state.sessions = new Map(sessions.map((s) => [s.sessionId, s]));
  const list = el("queue-list");
  list.innerHTML = "";
  el("queue-empty").classList.toggle("hidden", sessions.length > 0);

  // Header count: claimable (online, waiting) vs offline (customer disconnected
  // but the request is still queued and will reconnect).
  const onlineWaiting = sessions.filter((s) => s.status !== "active" && s.online !== false).length;
  const offlineCount = sessions.filter((s) => s.status !== "active" && s.online === false).length;
  const countEl = document.getElementById("queue-count");
  if (countEl) {
    const parts = [];
    if (onlineWaiting) parts.push(`${onlineWaiting} waiting`);
    if (offlineCount) parts.push(`${offlineCount} offline`);
    countEl.textContent = parts.length ? ` · ${parts.join(" · ")}` : "";
  }

  for (const s of sessions) {
    const offline = s.online === false;
    const mine = s.status === "active" && s.expertName === state.expertName;
    const takenByOther = s.status === "active" && !mine;
    const div = document.createElement("div");
    div.className =
      "queue-item" +
      (s.sessionId === state.activeId ? " active" : "") +
      (offline ? " offline" : "");

    let statusClass, statusText;
    if (offline) {
      statusClass = "offline";
      const since = relTime(s.createdAt);
      statusText = since ? `Offline · waiting ${since}` : "Offline";
    } else if (mine) {
      statusClass = "active";
      statusText = "Active (you)";
    } else if (takenByOther) {
      statusClass = "taken";
      statusText = `With ${escapeHtml(s.expertName)}`;
    } else {
      statusClass = "waiting";
      const since = relTime(s.createdAt);
      statusText = since ? `Waiting · ${since}` : "Waiting";
    }

    div.innerHTML = `
      <div class="qname">${escapeHtml(s.customerName)}</div>
      <div class="qproject">${escapeHtml(s.projectDir)}</div>
      ${s.issue ? `<div class="qissue">${escapeHtml(s.issue)}</div>` : ""}
      <div class="qstatus ${statusClass}">${statusText}</div>`;

    if (offline) {
      // Can't claim an offline request — the WebRTC peer needs a live machine.
      // It stays in the queue and becomes claimable when the customer returns.
      div.title =
        "The customer's machine is offline. This request stays in the queue and becomes claimable when they reconnect.";
      div.addEventListener("click", () =>
        status("This request is offline — it becomes claimable when the customer reconnects."),
      );
    } else if (!takenByOther) {
      div.addEventListener("click", () => {
        if (mine || s.sessionId === state.activeId) {
          openWorkspace(s);
        } else if (state.pc) {
          // One session at a time: activeId and the peer connection must stay
          // in lockstep, so a second claim requires ending the current one.
          status("End the current session before claiming another.");
        } else {
          claimSession(s.sessionId);
        }
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
  openWorkspace({
    sessionId,
    customerName: session?.customerName ?? "Customer",
    projectDir: session?.projectDir ?? "",
    permissions: session?.permissions,
    status: "active",
    expertName: state.expertName,
  });
  startWebRTC(sessionId).catch((err) => {
    status(`Could not start the peer connection: ${err.message}`);
  });
}

/* ── Workspace UI ─────────────────────────────────────────────────── */

function openWorkspace(session) {
  state.activeId = session.sessionId;
  el("ws-idle").classList.add("hidden");
  el("ws-active").classList.remove("hidden");
  el("ws-body").classList.remove("hidden");
  el("ws-title").textContent = `${session.customerName} — ${session.projectDir}`;
  renderPerms(session);
}

function renderPerms(session) {
  const p = session.permissions || { files: false, terminal: false, browser: false };
  const chip = (on, label) => `<span class="perm-chip ${on ? "on" : "off"}">${label}</span>`;
  el("ws-perms").innerHTML =
    chip(p.files, "Files") +
    chip(p.terminal, "Terminal") +
    chip(p.browser, p.browserPort ? `Browser :${escapeHtml(p.browserPort)}` : "Browser");
}

/* ── WebRTC (browser is the offerer) ──────────────────────────────── */

async function startWebRTC(sessionId) {
  teardownPeer(); // drop any previous session's peer connection first
  resetWorkspace();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;

  // The MCP channel (files/browser tools) plus the first terminal channel.
  // Additional terminals open extra "pty-N" channels in-band later.
  const dcMcp = pc.createDataChannel("mcp");
  state.dcMcp = dcMcp;
  dcMcp.onopen = () => initMcp(dcMcp);
  dcMcp.onclose = () => state.mcp?.fail("data channel closed");

  const first = addTerminal();
  if (first) setActivePanel(terminalKey(first));

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
    // The context file opens independently of the tree: it's a single direct
    // read, so the expert sees it even if the listing is slow or fails.
    await loadFiles();
    await autoOpenContext();
  } catch (err) {
    status(`Failed to start MCP session: ${err.message}`);
  }
}

/* ── Terminals (one PTY data channel per tab) ─────────────────────── */

const TERMINAL_THEME = {
  background: "#08080C",
  foreground: "#C8C8D2",
  cursor: "#F5A623",
  selectionBackground: "#33333d",
};

function terminalKey(t) {
  return `terminal:${t.id}`;
}

function activeTerminal() {
  if (typeof state.activePanel !== "string" || !state.activePanel.startsWith("terminal:")) return null;
  return state.terminals.find((t) => terminalKey(t) === state.activePanel) ?? null;
}

/**
 * Open a new terminal tab. The first terminal keeps the historical channel
 * label "pty"; later ones use "pty-2", "pty-3", … — the agent routes any
 * pty/pty-* channel to a fresh shell.
 */
function addTerminal() {
  if (!state.pc) return null;
  const n = ++state.termCounter;
  const t = {
    id: n,
    title: `Terminal ${n}`,
    label: n === 1 ? "pty" : `pty-${n}`,
    dc: null,
    term: null,
    fit: null,
    host: null,
    exited: false,
  };
  try {
    t.dc = state.pc.createDataChannel(t.label);
  } catch (err) {
    status(`Could not open a terminal channel: ${err.message}`);
    return null;
  }
  state.terminals = [...state.terminals, t];
  t.dc.onopen = () => initTerminal(t);
  t.dc.onclose = () => {
    if (t.term && !t.exited) t.term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
  };
  renderTermTabs();
  return t;
}

function initTerminal(t) {
  const host = document.createElement("div");
  host.className = "term-instance";
  el("terminals-host").appendChild(host);
  t.host = host;

  const term = new Terminal({
    fontSize: 12,
    fontFamily: "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,monospace",
    cursorBlink: true,
    theme: TERMINAL_THEME,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  t.term = term;
  t.fit = fit;

  // Expert keystrokes → shell on the customer's machine.
  term.onData((d) => {
    if (t.dc?.readyState === "open") t.dc.send(JSON.stringify({ t: "input", d }));
  });
  t.dc.onmessage = (ev) => handleTermMessage(t, ev);

  const isActive = state.activePanel === terminalKey(t);
  host.classList.toggle("hidden", !isActive);
  if (isActive) {
    safeFit(t, false);
    term.focus();
  }
  // Open the shell sized to the panel (or 80x24 until first visible fit).
  t.dc.send(JSON.stringify({ t: "open", cols: term.cols, rows: term.rows }));
}

function handleTermMessage(t, ev) {
  let m;
  try {
    m = JSON.parse(ev.data);
  } catch {
    return;
  }
  switch (m.t) {
    case "data":
      t.term?.write(m.d);
      break;
    case "ready":
      t.exited = false;
      break;
    case "denied":
      t.exited = true;
      t.term?.write(`\r\n\x1b[31mTerminal access not granted: ${m.reason}\x1b[0m\r\n`);
      break;
    case "exit":
      t.exited = true;
      t.term?.write(
        `\r\n\x1b[90m[terminal exited${m.reason ? ": " + m.reason : ""} — open a new one with +]\x1b[0m\r\n`,
      );
      break;
  }
}

/** Refit an on-screen terminal to its host and tell the far shell (resize). */
function safeFit(t, notify = true) {
  if (!t?.term || !t.fit || !t.host || t.host.classList.contains("hidden")) return;
  try {
    t.fit.fit();
    if (notify && t.dc?.readyState === "open") {
      t.dc.send(JSON.stringify({ t: "resize", cols: t.term.cols, rows: t.term.rows }));
    }
  } catch {
    /* host not laid out yet */
  }
}

function closeTerminal(t) {
  try {
    if (t.dc?.readyState === "open") t.dc.send(JSON.stringify({ t: "close" }));
  } catch {
    /* ignore */
  }
  disposeTerminal(t);
  state.terminals = state.terminals.filter((x) => x !== t);
  if (state.activePanel === terminalKey(t)) {
    const last = state.terminals[state.terminals.length - 1];
    setActivePanel(last ? terminalKey(last) : "browser");
  } else {
    renderTermTabs();
  }
}

function disposeTerminal(t) {
  try {
    t.dc?.close();
  } catch {
    /* ignore */
  }
  try {
    t.term?.dispose();
  } catch {
    /* ignore */
  }
  t.host?.remove();
  t.dc = null;
  t.term = null;
  t.fit = null;
  t.host = null;
}

window.addEventListener("resize", () => {
  const t = activeTerminal();
  if (t) safeFit(t);
});

function status(msg) {
  const t = state.terminals.find((x) => x.term);
  if (t) t.term.write(`\r\n\x1b[90m» ${msg}\x1b[0m\r\n`);
  else console.log("[get-an-expert]", msg);
}

/* ── Bottom panel tabs ────────────────────────────────────────────── */

function setActivePanel(key) {
  state.activePanel = key;
  const isTerm = typeof key === "string" && key.startsWith("terminal:");
  el("terminals-host").classList.toggle("hidden", !isTerm);
  el("panel-browser").classList.toggle("hidden", key !== "browser");
  el("panel-chat").classList.toggle("hidden", key !== "chat");
  for (const t of state.terminals) t.host?.classList.toggle("hidden", key !== terminalKey(t));
  renderTermTabs();
  if (isTerm) {
    const t = activeTerminal();
    if (t) {
      requestAnimationFrame(() => {
        safeFit(t);
        t.term?.focus();
      });
    }
  }
  if (key === "chat") {
    state.chatUnread = 0;
    updateChatBadge();
    el("chat-input").focus();
  }
}

function renderTermTabs() {
  const bar = el("term-tabs");
  bar.innerHTML = "";
  for (const t of state.terminals) {
    const tab = document.createElement("button");
    tab.className = "panel-tab" + (state.activePanel === terminalKey(t) ? " active" : "");
    const label = document.createElement("span");
    label.textContent = t.title;
    tab.appendChild(label);
    const close = document.createElement("span");
    close.className = "tab-close";
    close.title = "Close terminal";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTerminal(t);
    });
    tab.appendChild(close);
    tab.addEventListener("click", () => setActivePanel(terminalKey(t)));
    bar.appendChild(tab);
  }
  el("tab-browser").classList.toggle("active", state.activePanel === "browser");
  el("tab-chat").classList.toggle("active", state.activePanel === "chat");
}

el("term-add").addEventListener("click", () => {
  if (!state.pc) return;
  const t = addTerminal();
  if (t) setActivePanel(terminalKey(t));
});
el("tab-browser").addEventListener("click", () => setActivePanel("browser"));
el("tab-chat").addEventListener("click", () => setActivePanel("chat"));

/* ── File explorer ────────────────────────────────────────────────── */

el("refresh-files").addEventListener("click", loadFiles);

el("sidebar-toggle").addEventListener("click", () => {
  const collapsed = el("sidebar").classList.toggle("collapsed");
  const btn = el("sidebar-toggle");
  btn.textContent = collapsed ? "▸" : "◂";
  btn.title = collapsed ? "Expand explorer" : "Collapse explorer";
  const t = activeTerminal();
  if (t) requestAnimationFrame(() => safeFit(t));
});

/** Load the top level of the tree. Subdirectories load on demand (loadDir). */
async function loadFiles() {
  if (!state.mcp) return;
  const epoch = state.sessionEpoch;
  const treeEl = el("file-tree");
  treeEl.innerHTML = `<div class="tree-note">Loading…</div>`;
  // Fresh listing: drop any tree we accumulated for a previous view.
  state.fileEntries = [];
  state.listTruncated = false;
  state.loadedDirs = new Set();
  state.loadingDirs = new Set();
  state.dirErrors = new Map();
  state.expandedDirs = new Set();
  let res;
  try {
    res = await state.mcp.callTool("list_files", { dir: ".", depth: 1 });
  } catch (err) {
    if (epoch !== state.sessionEpoch) return;
    treeEl.innerHTML = `<div class="tree-note">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (epoch !== state.sessionEpoch) return; // a newer session owns the UI now
  if (res.isError) {
    treeEl.innerHTML = `<div class="tree-note">${escapeHtml(res.text)}</div>`;
    return;
  }
  let payload;
  try {
    payload = JSON.parse(res.text);
  } catch {
    treeEl.innerHTML = `<div class="tree-note">Unexpected list_files response.</div>`;
    return;
  }
  state.fileEntries = Array.isArray(payload.entries) ? payload.entries : [];
  state.listTruncated = payload.truncated === true;
  state.loadedDirs = new Set(["."]);
  renderTree();
}

/** Fetch one directory's immediate children when the expert expands it. */
async function loadDir(path) {
  if (!state.mcp) return;
  if (state.loadedDirs.has(path) || state.loadingDirs.has(path)) return;
  const epoch = state.sessionEpoch;
  state.loadingDirs = new Set(state.loadingDirs).add(path);
  const nextErrors = new Map(state.dirErrors);
  nextErrors.delete(path);
  state.dirErrors = nextErrors;
  renderTree();

  const finishLoading = () => {
    const next = new Set(state.loadingDirs);
    next.delete(path);
    state.loadingDirs = next;
  };
  const failWith = (message) => {
    if (epoch !== state.sessionEpoch) return;
    finishLoading();
    state.dirErrors = new Map(state.dirErrors).set(path, message);
    renderTree();
  };

  let res;
  try {
    res = await state.mcp.callTool("list_files", { dir: path, depth: 1 });
  } catch (err) {
    failWith(err.message);
    return;
  }
  if (epoch !== state.sessionEpoch) return;
  if (res.isError) {
    failWith(res.text);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(res.text);
  } catch {
    failWith("Unexpected list_files response.");
    return;
  }
  finishLoading();
  mergeEntries(Array.isArray(payload.entries) ? payload.entries : []);
  if (payload.truncated === true) state.listTruncated = true;
  state.loadedDirs = new Set(state.loadedDirs).add(path);
  renderTree();
}

/** Merge freshly fetched entries into the accumulated list, deduped by path. */
function mergeEntries(entries) {
  const seen = new Set(state.fileEntries.map((e) => Viewer.normalizePath(e.path)));
  const merged = state.fileEntries.slice();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string") continue;
    const norm = Viewer.normalizePath(entry.path);
    if (norm === "" || seen.has(norm)) continue;
    seen.add(norm);
    merged.push(entry);
  }
  state.fileEntries = merged;
}

function renderTree() {
  const treeEl = el("file-tree");
  treeEl.innerHTML = "";
  const nodes = Viewer.buildTree(state.fileEntries);
  if (nodes.length === 0) {
    treeEl.innerHTML = `<div class="tree-note">No files visible.</div>`;
    return;
  }
  appendTreeNodes(treeEl, nodes, 0);
  if (state.listTruncated) {
    const note = document.createElement("div");
    note.className = "tree-note";
    note.textContent = "…(listing truncated)";
    treeEl.appendChild(note);
  }
}

function appendTreeNodes(container, nodes, depth) {
  for (const node of nodes) {
    const row = document.createElement("div");
    const isActiveFile = node.type === "file" && node.path === state.tabState.active;
    row.className = "tree-row " + node.type + (isActiveFile ? " active" : "");
    row.style.paddingLeft = 6 + depth * 12 + "px";
    row.title = node.path;
    const chev = document.createElement("span");
    chev.className = "chev";
    const name = document.createElement("span");
    name.className = "fname";
    name.textContent = node.name;
    row.append(chev, name);
    if (node.type === "dir") {
      const open = state.expandedDirs.has(node.path);
      chev.textContent = open ? "▾" : "▸";
      row.addEventListener("click", () => toggleDir(node.path));
      container.appendChild(row);
      if (open) {
        if (state.loadingDirs.has(node.path)) {
          appendTreeNote(container, depth + 1, "Loading…");
        } else if (state.dirErrors.has(node.path)) {
          appendTreeNote(container, depth + 1, state.dirErrors.get(node.path));
        } else {
          appendTreeNodes(container, node.children, depth + 1);
        }
      }
    } else {
      row.addEventListener("click", () => openFile(node.path));
      container.appendChild(row);
    }
  }
}

/** An indented, non-interactive status row under a folder (loading / error). */
function appendTreeNote(container, depth, text) {
  const note = document.createElement("div");
  note.className = "tree-row tree-note";
  note.style.paddingLeft = 6 + depth * 12 + "px";
  note.textContent = text;
  container.appendChild(note);
}

function toggleDir(path) {
  const next = new Set(state.expandedDirs);
  const opening = !next.has(path);
  if (opening) next.add(path);
  else next.delete(path);
  state.expandedDirs = next;
  renderTree();
  // Fetch children the first time this folder is opened.
  if (opening && !state.loadedDirs.has(path) && !state.loadingDirs.has(path)) {
    loadDir(path);
  }
}

/**
 * Open the session context file as the first tab, once, if the agent wrote one.
 *
 * This reads the file directly rather than waiting for it to appear in the tree
 * — the context lives in a nested `.get-an-expert/` folder that the lazy
 * explorer hasn't expanded, so relying on the listing would never surface it.
 */
async function autoOpenContext() {
  if (state.contextAutoOpened || !state.mcp) return;
  state.contextAutoOpened = true; // attempt once per session, success or not
  const epoch = state.sessionEpoch;
  let res;
  try {
    res = await state.mcp.callTool("read_file", { path: Viewer.CONTEXT_FILE });
  } catch {
    return; // channel error; nothing to open
  }
  if (epoch !== state.sessionEpoch) return;
  if (res.isError) return; // no context file for this session
  let payload;
  try {
    payload = JSON.parse(res.text);
  } catch {
    return;
  }
  // Prime the cache so openFile shows it without a second read.
  state.files.set(Viewer.CONTEXT_FILE, {
    content: typeof payload.content === "string" ? payload.content : "",
    truncated: payload.truncated === true,
  });
  openFile(Viewer.CONTEXT_FILE);
}

/* ── File tabs + viewer (view-only by design) ─────────────────────── */

async function openFile(path) {
  state.tabState = Viewer.openTab(state.tabState, path);
  renderTabs();
  renderTree();
  renderViewer();
  if (state.files.has(path) || state.pendingReads.has(path) || !state.mcp) return;

  const epoch = state.sessionEpoch;
  state.pendingReads.add(path);
  let data;
  try {
    const res = await state.mcp.callTool("read_file", { path });
    if (res.isError) {
      data = { error: res.text };
    } else {
      const payload = JSON.parse(res.text);
      data = {
        content: typeof payload.content === "string" ? payload.content : "",
        truncated: payload.truncated === true,
      };
    }
  } catch (err) {
    data = { error: err.message };
  }
  if (epoch !== state.sessionEpoch) return; // a newer session owns the UI now
  state.pendingReads.delete(path);
  state.files.set(path, data);
  renderViewer();
}

function focusFileTab(path) {
  state.tabState = Viewer.focusTab(state.tabState, path);
  renderTabs();
  renderTree();
  renderViewer();
}

function closeFileTab(path) {
  state.tabState = Viewer.closeTab(state.tabState, path);
  state.files.delete(path); // drop the cache so reopening re-reads fresh content
  state.renderPref.delete(path);
  renderTabs();
  renderTree();
  renderViewer();
}

function renderTabs() {
  const bar = el("tab-bar");
  bar.innerHTML = "";
  for (const tab of state.tabState.tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "editor-tab" + (tab.path === state.tabState.active ? " active" : "");
    tabEl.title = tab.path;
    const name = document.createElement("span");
    name.textContent = Viewer.baseName(tab.path);
    tabEl.appendChild(name);
    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFileTab(tab.path);
    });
    tabEl.appendChild(close);
    tabEl.addEventListener("click", () => focusFileTab(tab.path));
    bar.appendChild(tabEl);
  }
}

function renderViewer() {
  const viewer = el("viewer");
  const toolbar = el("viewer-toolbar");
  toolbar.classList.add("hidden");
  toolbar.innerHTML = "";
  viewer.innerHTML = "";

  const path = state.tabState.active;
  if (!path) {
    viewer.appendChild(divWith("viewer-empty", "Select a file from the explorer to view it."));
    return;
  }
  const data = state.files.get(path);
  if (!data) {
    viewer.appendChild(divWith("viewer-empty", `Loading ${path}…`));
    return;
  }
  if (data.error) {
    viewer.appendChild(divWith("viewer-error", `Could not read ${path}\n${data.error}`));
    return;
  }
  if (data.truncated) {
    viewer.appendChild(
      divWith("viewer-banner", "This file was truncated by read_file — showing the beginning only."),
    );
  }

  const mode = Viewer.viewerMode(path);
  if (mode === "markdown" || mode === "html") {
    renderModeToolbar(toolbar, path, mode);
    const pref = state.renderPref.get(path) ?? "rendered";
    if (pref === "rendered") {
      viewer.appendChild(mode === "markdown" ? markdownFrame(data.content) : htmlFrame(data.content));
    } else {
      viewer.appendChild(codeNode(data.content, mode === "markdown" ? "markdown" : "xml"));
    }
  } else {
    viewer.appendChild(codeNode(data.content, mode === "code" ? Viewer.languageFor(path) : null));
  }
}

function renderModeToolbar(toolbar, path, mode) {
  const pref = state.renderPref.get(path) ?? "rendered";
  const toggle = document.createElement("div");
  toggle.className = "mode-toggle";
  const options = [
    { key: "rendered", label: mode === "markdown" ? "Rendered" : "Preview" },
    { key: "source", label: "Source" },
  ];
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.textContent = opt.label;
    btn.className = pref === opt.key ? "on" : "";
    btn.addEventListener("click", () => {
      state.renderPref.set(path, opt.key);
      renderViewer();
    });
    toggle.appendChild(btn);
  }
  toolbar.appendChild(toggle);

  const note = document.createElement("span");
  note.className = "viewer-note";
  note.textContent =
    mode === "html"
      ? "Sandboxed preview — scripts and relative/external assets don't load; use the Browser tab for dev servers."
      : "Sandboxed preview — links are disabled and remote assets are blocked.";
  toolbar.appendChild(note);
  toolbar.classList.remove("hidden");
}

function codeNode(content, language) {
  const pre = document.createElement("pre");
  pre.className = "code-view";
  const code = document.createElement("code");
  const hljs = window.hljs;
  const canHighlight =
    language && hljs && hljs.getLanguage(language) && content.length <= HIGHLIGHT_MAX_CHARS;
  if (canHighlight) {
    try {
      code.innerHTML = hljs.highlight(content, { language }).value;
      code.className = "hljs language-" + language;
    } catch {
      code.textContent = content;
    }
  } else {
    code.textContent = content;
  }
  pre.appendChild(code);
  return pre;
}

// Styles injected into the sandboxed markdown preview frame (matches the
// dashboard palette; the frame itself blocks scripts and network loads).
const MD_FRAME_CSS = [
  "body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:14px;line-height:1.65;color:#D6D6DE;background:#0E0E13;padding:20px 26px;max-width:860px}",
  "h1,h2,h3,h4,h5,h6{color:#E4E4EC;line-height:1.25;margin:1.2em 0 0.5em}",
  "h1,h2{border-bottom:1px solid #282830;padding-bottom:0.3em}",
  "a{color:#60A5FA;text-decoration:none;pointer-events:none}",
  "p{margin:0.7em 0}",
  "code{font-family:'SF Mono',ui-monospace,monospace;font-size:0.9em;background:#1C1C24;padding:2px 5px;border-radius:4px}",
  "pre{background:#131318;border:1px solid #282830;border-radius:8px;padding:12px 14px;overflow:auto}",
  "pre code{background:transparent;padding:0}",
  "blockquote{border-left:3px solid #383840;margin:0.8em 0;padding:2px 14px;color:#90909B}",
  "table{border-collapse:collapse;margin:1em 0}",
  "th,td{border:1px solid #282830;padding:6px 10px}",
  "img{max-width:100%}",
  "ul,ol{padding-left:1.6em}",
  "hr{border:none;border-top:1px solid #282830;margin:1.5em 0}",
].join("");

// sandbox="" already blocks scripts/forms/navigation; this meta CSP also stops
// the previewed document from fetching remote sub-resources (images, fonts,
// stylesheets) — a customer-controlled file must not beacon out from the
// expert's browser. Inline styles and data: images stay allowed.
const FRAME_CSP =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">`;

function markdownFrame(markdown) {
  let html;
  try {
    html = window.marked.parse(markdown);
  } catch {
    return codeNode(markdown, "markdown"); // bad markdown → show the source
  }
  const iframe = document.createElement("iframe");
  iframe.className = "preview-frame md";
  iframe.setAttribute("sandbox", ""); // no scripts, no navigation, no forms
  iframe.srcdoc = `<!doctype html><meta charset="utf-8">${FRAME_CSP}<style>${MD_FRAME_CSS}</style><body>${html}</body>`;
  return iframe;
}

function htmlFrame(html) {
  const iframe = document.createElement("iframe");
  iframe.className = "preview-frame";
  iframe.setAttribute("sandbox", ""); // no scripts, no navigation, no forms
  iframe.srcdoc = `<!doctype html>${FRAME_CSP}${html}`;
  return iframe;
}

function divWith(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

/* ── Chat (relay-brokered; renders only what the relay echoes back) ── */

function onChatHistory(msg) {
  if (msg.sessionId !== state.activeId) return;
  state.chatMessages = Array.isArray(msg.messages) ? [...msg.messages] : [];
  if (state.activePanel !== "chat") {
    state.chatUnread = state.chatMessages.filter((m) => m.from === "customer").length;
  }
  renderChat();
  updateChatBadge();
}

function onChatMessage(msg) {
  if (msg.sessionId !== state.activeId || !msg.message) return;
  // Keep only the most recent messages so a long-lived or flooded session
  // can't grow this array (and its full re-render) without bound.
  const next = [...state.chatMessages, msg.message];
  state.chatMessages = next.length > CHAT_MAX_RENDER ? next.slice(-CHAT_MAX_RENDER) : next;
  if (state.activePanel !== "chat") state.chatUnread += 1;
  renderChat();
  updateChatBadge();
}

function renderChat() {
  const list = el("chat-messages");
  list.innerHTML = "";
  if (state.chatMessages.length === 0) {
    list.appendChild(divWith("muted chat-empty", "No messages yet. The customer sees what you send here."));
    return;
  }
  for (const m of state.chatMessages) {
    const mine = m.from === "expert";
    const row = document.createElement("div");
    row.className = "chat-msg" + (mine ? " mine" : "");
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = mine ? "You" : m.name || "Customer";
    meta.appendChild(who);
    const time = formatTime(m.at);
    if (time) meta.append(` · ${time}`);
    const text = document.createElement("div");
    text.className = "chat-text";
    text.textContent = m.text ?? "";
    row.append(meta, text);
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

function sendChat() {
  const input = el("chat-input");
  const text = input.value.trim();
  if (!text || !state.activeId) return;
  if (text.length > CHAT_MAX_CHARS) {
    el("chat-note").textContent = `Message too long — max ${CHAT_MAX_CHARS} characters.`;
    return;
  }
  el("chat-note").textContent = "";
  relaySend({ type: "chat", sessionId: state.activeId, text });
  input.value = "";
  // The message renders when the relay echoes it back — never optimistically.
}

function updateChatBadge() {
  const badge = el("chat-badge");
  if (state.chatUnread > 0) {
    badge.textContent = state.chatUnread > 99 ? "99+" : String(state.chatUnread);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

el("chat-send").addEventListener("click", sendChat);
el("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

/* ── Browser tab (screenshot + console of the customer's dev server) ── */

el("browser-refresh").addEventListener("click", captureBrowser);

async function captureBrowser() {
  if (!state.mcp) return;
  const epoch = state.sessionEpoch;
  const card = el("browser-card");
  card.innerHTML = `<div class="muted">Capturing…</div>`;
  let shot;
  try {
    shot = await state.mcp.callTool("browser_screenshot", {});
  } catch (err) {
    if (epoch !== state.sessionEpoch) return;
    card.innerHTML = `<div class="muted">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (epoch !== state.sessionEpoch) return; // a newer session owns the UI now
  if (shot.isError) {
    card.innerHTML = `<div class="muted">${escapeHtml(shot.text)}</div>`;
    return;
  }
  let p;
  try {
    p = JSON.parse(shot.text);
  } catch {
    card.innerHTML = `<div class="muted">Unexpected browser_screenshot response.</div>`;
    return;
  }

  // Console is a second, best-effort call so the network + console line matches
  // the real page state.
  let con = { entries: [], note: "" };
  try {
    const c = await state.mcp.callTool("browser_console", {});
    if (!c.isError) con = JSON.parse(c.text);
  } catch {
    /* ignore */
  }
  if (epoch !== state.sessionEpoch) return;

  const errors = (con.entries || []).filter((e) => e.level === "error").length;
  const n = (con.entries || []).length;
  const consoleLine =
    n === 0
      ? "Console: clean"
      : `Console: ${n} msg${n > 1 ? "s" : ""}${errors ? ` · ${errors} error${errors > 1 ? "s" : ""}` : ""}`;

  // Everything below comes from the customer's machine — escape before it
  // touches innerHTML, and only accept a well-formed base64 payload.
  const port = escapeHtml(p.port);
  const httpStatus = escapeHtml(p.status ?? "?");
  const imageBase64 =
    typeof p.imageBase64 === "string" && /^[A-Za-z0-9+/=]+$/.test(p.imageBase64)
      ? p.imageBase64
      : null;
  const note = typeof p.note === "string" ? p.note : "";
  const html = typeof p.html === "string" ? p.html : "";
  let visual;
  if (imageBase64) {
    visual = `<img class="shot" alt="localhost:${port}" src="data:image/png;base64,${imageBase64}" title="Click to enlarge" />`;
  } else if (html) {
    // No headless browser on the customer's machine: show the page's HTML
    // source (escaped) so the expert can still read the markup.
    visual =
      `<div class="browser-frame">` +
      `<strong>${escapeHtml(p.title ?? "(no title)")}</strong>` +
      (note ? `<div class="browser-note">${escapeHtml(note)}</div>` : "") +
      `<pre class="html-src">${escapeHtml(html)}</pre>` +
      `</div>`;
  } else {
    visual =
      `<div class="browser-frame">` +
      `<strong>${escapeHtml(p.title ?? "(no title)")}</strong><br />` +
      `<span style="color:#666">localhost:${port}</span>` +
      (note ? `<div class="browser-note">${escapeHtml(note)}</div>` : "") +
      `</div>`;
  }

  card.innerHTML =
    visual +
    `<div class="browser-status ${p.ok ? "up" : "down"}">localhost:${port} · ${p.ok ? "HTTP " + httpStatus : "unreachable"}</div>` +
    `<div class="browser-console ${errors ? "bad" : ""}">${consoleLine}</div>`;

  const img = card.querySelector(".shot");
  if (img) img.addEventListener("click", () => openShot(img.src, p));
}

function openShot(src, p) {
  const port = escapeHtml(p.port);
  const ov = document.createElement("div");
  ov.className = "shot-overlay";
  ov.innerHTML =
    `<div class="shot-box"><div class="shot-bar">localhost:${port} · ${p.title ? escapeHtml(p.title) + " · " : ""}HTTP ${escapeHtml(p.status ?? "?")}<button class="shot-x">✕</button></div>` +
    `<img src="${src}" alt="localhost:${port} full" /></div>`;
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
}

/* ── Session end + teardown ───────────────────────────────────────── */

el("end-btn").addEventListener("click", () => {
  if (!state.activeId) return;
  const sessionId = state.activeId;
  relaySend({ type: "end-session", sessionId, reason: "expert ended the session" });
  // Reset the dashboard immediately — the relay notifies the customer, not the
  // expert who clicked End, so return to the queue view ourselves.
  onSessionEnded(sessionId, "you ended the session", null);
});

function onSessionEnded(sessionId, reason, durationMs) {
  if (sessionId !== state.activeId) return;
  status(`Session ended (${reason ?? "done"}). Duration: ${formatDuration(durationMs)}. All access revoked.`);
  teardownPeer();
  resetWorkspace();
  state.activeId = null;
  el("ws-active").classList.add("hidden");
  el("ws-body").classList.add("hidden");
  el("ws-idle").classList.remove("hidden");
}

function teardownPeer() {
  state.mcp?.fail("session ended");
  state.mcp = null;
  for (const t of state.terminals) {
    try {
      if (t.dc?.readyState === "open") t.dc.send(JSON.stringify({ t: "close" }));
    } catch {
      /* ignore */
    }
    disposeTerminal(t);
  }
  state.terminals = [];
  try {
    state.dcMcp?.close();
  } catch {
    /* ignore */
  }
  try {
    state.pc?.close();
  } catch {
    /* ignore */
  }
  state.dcMcp = null;
  state.pc = null;
}

/** Blank every workspace surface (called on claim and on session end). */
function resetWorkspace() {
  state.sessionEpoch += 1; // invalidate any in-flight async results
  for (const t of state.terminals) disposeTerminal(t);
  state.terminals = [];
  state.termCounter = 0;
  state.activePanel = null;
  state.fileEntries = [];
  state.listTruncated = false;
  state.expandedDirs = new Set();
  state.loadedDirs = new Set();
  state.loadingDirs = new Set();
  state.dirErrors = new Map();
  state.tabState = Viewer.emptyTabState();
  state.files = new Map();
  state.pendingReads = new Set();
  state.renderPref = new Map();
  state.contextAutoOpened = false;
  state.chatMessages = [];
  state.chatUnread = 0;
  el("terminals-host").innerHTML = "";
  el("file-tree").innerHTML = `<div class="tree-note">Not loaded yet.</div>`;
  el("browser-card").innerHTML = `<div class="muted">Not captured yet — click Capture.</div>`;
  el("chat-input").value = "";
  el("chat-note").textContent = "";
  renderTabs();
  renderViewer();
  renderTermTabs();
  renderChat();
  updateChatBadge();
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
function formatTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
