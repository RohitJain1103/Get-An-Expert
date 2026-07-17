/**
 * Get An Expert, standalone customer chat page.
 *
 * Link format: /chat#<sessionId>.<customerToken>. Both live in the URL
 * fragment, which never reaches the server or its logs. Connects to the
 * relay's /customer WebSocket. The relay echoes every accepted message back
 * (including our own), so this page never renders optimistically: the echo
 * is the single render path.
 *
 * All decisions (link parsing, the state machine, profile validation) live in
 * chat-core.js (GaeChat) and are unit-tested. This file owns only the DOM and
 * the socket: it dispatches each relay message through GaeChat.reduce, then
 * paints the whole page from the returned state.
 */
(() => {
  "use strict";

  const G = globalThis.GaeChat;
  const RECONNECT_MS = 3000;

  /* ── Copy deck, verbatim from the locked visual spec ───────────────── */
  const WAITING_BANNER =
    "You're in the queue. Send a message now and your expert reads it the moment they join.";
  const ENDED_BANNER = "This session has ended. All access revoked.";
  const FAILED_BANNER = "This session has ended or does not exist.";
  const CTX_HEADING = "What we've told the expert";
  const CTX_NOTE =
    "This is the summary. They get the full detail. Change it anytime, before or after someone picks it up.";
  // Chips that are categorically true without a per-session count. The two
  // count-bearing chips in the spec ("47 messages", "3 secrets removed") are
  // omitted until a wire contract carries the real numbers: a hardcoded count
  // would be a fabricated figure on every session.
  const CTX_CHIPS = ["Your agent's summary", "A short overview of your project"];
  const STEPS_HEADING = "What happens next";
  const STEPS = [
    "One expert picks this up.",
    "You'll see exactly who.",
    "Every action they take shows here, live.",
  ];
  const STEPS_FOOT =
    "Close this tab anytime. Your place in the queue holds, and this link brings you back.";
  const BENCH_HEADING = "Experts on bench";
  const BENCH_MORE = "100+ other experts";

  // LinkedIn glyph, verbatim from the spec's reference implementation.
  const LI_PATH =
    "M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8.1h4.56V23H.22V8.1zM8.34 8.1h4.37v2.03h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V23h-4.55v-7.2c0-1.72-.03-3.93-2.4-3.93-2.4 0-2.77 1.87-2.77 3.8V23H8.34V8.1z";

  const els = {
    connDot: document.getElementById("conn-dot"),
    connLabel: document.getElementById("conn-label"),
    banner: document.getElementById("banner"),
    pinned: document.getElementById("pinned"),
    pinLabel: document.getElementById("pin-label"),
    expertCard: document.getElementById("expert-card"),
    mini: document.getElementById("mini"),
    ctxMini: document.getElementById("ctx-mini"),
    access: document.getElementById("access"),
    accessBody: document.getElementById("access-body"),
    messages: document.getElementById("messages"),
    composer: document.getElementById("composer"),
    input: document.getElementById("input"),
    send: document.getElementById("send"),
    fatal: document.getElementById("fatal"),
    fatalTitle: document.getElementById("fatal-title"),
    fatalText: document.getElementById("fatal-text"),
  };

  /* ── DOM helpers ───────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function img(src, cls) {
    const n = document.createElement("img");
    n.src = src;
    if (cls) n.className = cls;
    n.alt = ""; // decorative: the name sits in adjacent text
    return n;
  }

  function linkedinAnchor(href, name, cls) {
    const a = document.createElement("a");
    if (cls) a.className = cls;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", name + " on LinkedIn");
    // Fixed constant markup, no interpolated user data.
    a.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + LI_PATH + '"/></svg>';
    return a;
  }

  function formatTime(at) {
    try {
      return new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function expertName() {
    return (state.expert && state.expert.name) || state.expertName || "Your expert";
  }

  /* ── State ─────────────────────────────────────────────────────────── */

  const link = G.parseLink(location.hash);
  if (!link) {
    showFatal(
      "Chat link is invalid",
      "This chat link is missing or malformed. Ask your agent for the chat link again. It looks like /chat#<session>.<token>.",
    );
    return;
  }

  let state = G.initialState();
  let connState = "connecting"; // "connecting" | "open" | "reconnecting"
  let ws = null;
  let reconnectTimer = null;

  /* ── Card builders ─────────────────────────────────────────────────── */

  function messageNode(m) {
    if (!m || typeof m.text !== "string" || typeof m.from !== "string") return null;
    const mine = m.from === "customer";
    const w = el("div", "msg " + (mine ? "mine" : "theirs"));
    const meta = el("div", "meta");
    meta.append(el("span", null, mine ? "YOU" : String(m.name || "Expert").toUpperCase()));
    meta.append(el("span", null, formatTime(m.at)));
    w.append(meta, el("div", "bubble", m.text));
    return w;
  }

  function activityNode(a) {
    if (!a || typeof a.summary !== "string") return null;
    const row = el("div", "msg activity");
    row.append(el("span", "act-dot"));
    row.append(el("span", "act-text", a.summary));
    row.append(el("span", "act-time", formatTime(a.at)));
    return row;
  }

  function feedNodes() {
    return state.feed
      .map((f) => (f.kind === "chat" ? messageNode(f.message) : activityNode(f.entry)))
      .filter(Boolean);
  }

  function contextCard() {
    const box = el("div", "c-ctx");
    box.append(el("div", "c-ctx-h", CTX_HEADING));
    if (state.issue) box.append(el("div", "c-ctx-issue", state.issue));
    const chips = el("div", "c-chips");
    CTX_CHIPS.forEach((t) => {
      const c = el("span", "c-chip");
      c.append(el("span", "tk", "✓")); // check mark
      c.append(el("span", null, t));
      chips.append(c);
    });
    box.append(chips);
    box.append(el("div", "c-ctx-note", CTX_NOTE));
    // Edit affordance is deferred to Track E; display-only here.
    return box;
  }

  function stepsCard() {
    const box = el("div", "c-steps");
    box.append(el("div", "c-steps-h", STEPS_HEADING));
    STEPS.forEach((t, i) => {
      const s = el("div", "c-step");
      s.append(el("span", "n", String(i + 1)));
      s.append(el("span", null, t));
      box.append(s);
    });
    box.append(el("div", "c-foot", STEPS_FOOT));
    return box;
  }

  function benchCard(list) {
    const box = el("div", "c-bench");
    const top = el("div", "c-bench-top");
    top.append(el("div", "c-bench-h", BENCH_HEADING));
    top.append(el("div", "c-bench-more", BENCH_MORE));
    box.append(top);
    const faces = el("div", "c-faces");
    for (const x of list) {
      const f = el("div", "c-face");
      f.append(img(x.photo));
      f.append(el("div", "nm", G.firstName(x.name)));
      f.append(el("div", "sb", x.tag)); // full tag; CSS truncates
      const w = el("div", "w");
      w.append(
        x.rating
          ? el("span", "r", "★ " + x.rating) // star + rating
          : el("span", "r pending", "no rating"),
      );
      if (x.linkedin) w.append(linkedinAnchor(x.linkedin, x.name, null));
      f.append(w);
      faces.append(f);
    }
    box.append(faces);
    return box;
  }

  function expertCardInto(node, profile) {
    node.replaceChildren();
    if (!G.validProfile(profile)) {
      // Refuse a malformed profile: name only, never a fabricated credential.
      const body = el("div", "c-cbody");
      const nrow = el("div", "c-nrow");
      nrow.append(el("div", "c-name", expertName()));
      body.append(nrow);
      node.append(body);
      return;
    }
    node.append(img(profile.photo, "c-photo"));
    const body = el("div", "c-cbody");

    const nrow = el("div", "c-nrow");
    nrow.append(el("div", "c-name", profile.name));
    if (profile.linkedin) nrow.append(linkedinAnchor(profile.linkedin, profile.name, "c-li"));
    nrow.append(
      profile.rating
        ? el("div", "c-rate", "★ " + profile.rating)
        : el("div", "c-rate pending", "rating needed"),
    );
    body.append(nrow);

    body.append(el("div", "c-role", profile.role));

    const cos = el("div", "c-cos");
    profile.companies.forEach((c, i) => {
      if (i > 0) cos.append(el("span", "dot", "·")); // middle dot
      if (c.logo) cos.append(img(c.logo));
      cos.append(el("span", null, c.label));
    });
    body.append(cos);

    const trow = el("div", "c-tagrow");
    trow.append(el("span", "c-tag", profile.tag));
    trow.append(
      typeof profile.fixesDelivered === "number"
        ? el("span", "c-fixes", profile.fixesDelivered + " fixes delivered")
        : el("span", "c-fixes pending", "fix count needed"),
    );
    body.append(trow);

    node.append(body);
  }

  function miniInto(node) {
    node.replaceChildren();
    if (state.expert && state.expert.photo) node.append(img(state.expert.photo));
    node.append(el("span", null, expertName() + " worked on this session."));
  }

  function accessBodyInto(node, perms) {
    node.replaceChildren();
    if (!perms) return;
    if (perms.files) node.append(el("span", "c-scope", "Files"));
    if (perms.terminal) node.append(el("span", "c-scope", "Terminal"));
    if (perms.browser) {
      node.append(
        el("span", "c-scope", perms.browserPort ? "Browser :" + perms.browserPort : "Browser"),
      );
    }
  }

  function ctxMiniInto(node, issue) {
    node.replaceChildren();
    node.append(el("span", "t", issue || ""));
    // Edit affordance is deferred to Track E; display-only here.
  }

  /* ── UI primitives ─────────────────────────────────────────────────── */

  function showFatal(title, text) {
    els.fatalTitle.textContent = title;
    els.fatalText.textContent = text;
    els.banner.classList.add("hidden");
    els.pinned.classList.add("hidden");
    els.messages.classList.add("hidden");
    els.composer.classList.add("hidden");
    els.fatal.classList.remove("hidden");
  }

  function setBanner(text, tone) {
    els.banner.className = "banner" + (tone ? " " + tone : "");
    els.banner.textContent = text;
    els.banner.classList.remove("hidden");
  }

  function enableComposer(placeholder) {
    els.composer.classList.remove("off");
    els.input.disabled = false;
    els.send.disabled = false;
    els.input.placeholder = placeholder;
  }

  function disableComposer(placeholder) {
    els.composer.classList.add("off");
    els.input.disabled = true;
    els.send.disabled = true;
    els.input.value = "";
    els.input.placeholder = placeholder;
  }

  function scrollFeed() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  function render() {
    renderConn();
    renderBody();
  }

  function renderConn() {
    let label, off;
    if (state.phase === "failed") {
      label = "OFFLINE";
      off = true;
    } else if (state.phase === "ended") {
      label = "ENDED";
      off = true;
    } else if (connState === "open") {
      label = "CONNECTED";
      off = false;
    } else if (connState === "reconnecting") {
      label = "RECONNECTING";
      off = true;
    } else {
      label = "CONNECTING";
      off = true;
    }
    els.connLabel.textContent = label;
    els.connDot.classList.toggle("off", off);
  }

  function renderBody() {
    if (state.phase === "failed") {
      els.pinned.classList.add("hidden");
      setBanner(FAILED_BANNER, "muted");
      els.messages.replaceChildren();
      disableComposer("Session unavailable");
      return;
    }

    if (state.phase === "waiting") {
      els.pinned.classList.add("hidden");
      setBanner(WAITING_BANNER, "");
      enableComposer("Message your expert");
      const nodes = [contextCard(), stepsCard()];
      if (state.bench.length) nodes.push(benchCard(state.bench));
      nodes.push(...feedNodes());
      els.messages.replaceChildren(...nodes);
      scrollFeed();
      return;
    }

    if (state.phase === "ended") {
      els.pinned.classList.remove("hidden");
      els.pinLabel.classList.add("hidden");
      els.expertCard.classList.add("hidden");
      els.mini.classList.remove("hidden");
      els.ctxMini.classList.add("hidden");
      els.access.classList.add("hidden");
      miniInto(els.mini);
      setBanner(ENDED_BANNER, "muted");
      els.messages.replaceChildren(...feedNodes());
      disableComposer("Session ended");
      scrollFeed();
      return;
    }

    // claimed (and working: same layout, the feed just carries activity rows)
    els.pinned.classList.remove("hidden");
    els.pinLabel.classList.remove("hidden");
    els.expertCard.classList.remove("hidden");
    els.mini.classList.add("hidden");
    els.ctxMini.classList.remove("hidden");
    els.access.classList.remove("hidden");
    els.access.open = false; // collapsed by default: check it, do not stare at it
    expertCardInto(els.expertCard, state.expert);
    ctxMiniInto(els.ctxMini, state.issue);
    accessBodyInto(els.accessBody, state.permissions);
    setBanner(G.firstName(expertName()) + " is here and working on your machine.", "");
    enableComposer("Message your expert");
    els.messages.replaceChildren(...feedNodes());
    scrollFeed();
  }

  /* ── Connection lifecycle ──────────────────────────────────────────── */

  function wsUrl() {
    return location.origin.replace(/^http/, "ws") + "/customer";
  }

  function scheduleReconnect() {
    if (state.phase === "ended" || state.phase === "failed" || reconnectTimer !== null) return;
    connState = "reconnecting";
    render();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function connect() {
    if (state.phase === "ended" || state.phase === "failed") return;
    connState = "connecting";
    render();
    let socket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          sessionId: link.sessionId,
          token: link.token,
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore unparseable frames
      }
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "hello-ok") connState = "open";
      state = G.reduce(state, msg);
      render();
    });

    socket.addEventListener("close", () => {
      if (ws === socket) ws = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // The close event follows and drives the reconnect.
    });
  }

  /* ── Sending (no optimistic render: wait for the echo) ─────────────── */

  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.phase === "ended" || state.phase === "failed") return;
    const text = els.input.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", text: text.slice(0, 2000) }));
    els.input.value = "";
    els.input.focus();
  });

  render();
  connect();
})();
