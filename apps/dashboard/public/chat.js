/**
 * Get An Expert — standalone customer chat page.
 *
 * Link format: /chat#<sessionId>.<customerToken> — both live in the URL
 * fragment, which never reaches the server or its logs. Connects to the
 * relay's /customer WebSocket. The relay echoes every accepted message back
 * (including our own), so this page never renders optimistically: the echo
 * is the single render path.
 */
(() => {
  "use strict";

  const RECONNECT_MS = 3000;
  const WAITING_COPY =
    "You're in the queue. An expert will join shortly — messages you send now will be delivered when they do.";

  const els = {
    connDot: document.getElementById("conn-dot"),
    connLabel: document.getElementById("conn-label"),
    banner: document.getElementById("banner"),
    messages: document.getElementById("messages"),
    empty: document.getElementById("empty"),
    composer: document.getElementById("composer"),
    input: document.getElementById("input"),
    send: document.getElementById("send"),
    fatal: document.getElementById("fatal"),
    fatalTitle: document.getElementById("fatal-title"),
    fatalText: document.getElementById("fatal-text"),
  };

  /* ── Link parsing: <sessionId>.<token>, split on the FIRST dot ── */

  function parseLink(hash) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const dot = raw.indexOf(".");
    if (dot <= 0 || dot === raw.length - 1) return undefined;
    return { sessionId: raw.slice(0, dot), token: raw.slice(dot + 1) };
  }

  const link = parseLink(location.hash);
  if (!link) {
    showFatal(
      "Chat link is invalid",
      "This chat link is missing or malformed. Ask your agent for the chat link again — it looks like /chat#<session>.<token>.",
    );
    return;
  }

  /* ── State ── */

  let ws = null;
  let ended = false; // session-ended received: stop sending + reconnecting
  let failed = false; // hello-failed received: stop reconnecting
  let reconnectTimer = null;

  /* ── UI helpers ── */

  function showFatal(title, text) {
    els.fatalTitle.textContent = title;
    els.fatalText.textContent = text;
    els.banner.classList.add("hidden");
    els.messages.classList.add("hidden");
    els.composer.classList.add("hidden");
    els.fatal.classList.remove("hidden");
  }

  function setConn(state, label) {
    els.connDot.className = "conn-dot" + (state ? " " + state : "");
    els.connLabel.textContent = label;
  }

  function setBanner(text, tone) {
    if (!text) {
      els.banner.classList.add("hidden");
      return;
    }
    els.banner.className = "banner" + (tone ? " " + tone : "");
    els.banner.textContent = text;
  }

  function disableComposer(placeholder) {
    els.input.disabled = true;
    els.send.disabled = true;
    els.input.value = "";
    els.input.placeholder = placeholder;
  }

  function clearMessages() {
    els.messages.replaceChildren(els.empty);
    els.empty.classList.remove("hidden");
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

  function renderMessage(message) {
    if (
      !message ||
      typeof message.text !== "string" ||
      typeof message.from !== "string"
    ) {
      return;
    }
    els.empty.classList.add("hidden");

    const mine = message.from === "customer";
    const wrap = document.createElement("div");
    wrap.className = "msg " + (mine ? "mine" : "theirs");

    const meta = document.createElement("div");
    meta.className = "meta";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = mine ? "You" : String(message.name || "Expert");
    const time = document.createElement("span");
    time.textContent = formatTime(message.at);
    meta.append(who, time);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;

    wrap.append(meta, bubble);
    els.messages.appendChild(wrap);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /** A live action the expert took on this machine (read/edit/command/etc.). */
  function renderActivity(entry) {
    if (!entry || typeof entry.summary !== "string") return;
    els.empty.classList.add("hidden");

    const row = document.createElement("div");
    row.className = "msg activity";
    const dot = document.createElement("span");
    dot.className = "act-dot";
    dot.textContent = "•";
    const text = document.createElement("span");
    text.className = "act-text";
    text.textContent = entry.summary;
    const time = document.createElement("span");
    time.className = "act-time";
    time.textContent = formatTime(entry.at);

    row.append(dot, text, time);
    els.messages.appendChild(row);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /* ── Session state transitions ── */

  function onSessionEnded() {
    ended = true;
    setBanner("This session has ended. Expert access has been revoked.", "muted");
    setConn("", "Session ended");
    disableComposer("Session ended");
  }

  function onHelloFailed() {
    failed = true;
    setBanner("This session has ended or doesn't exist.", "bad");
    setConn("error", "Not connected");
    disableComposer("Session unavailable");
  }

  function applyStatus(status, expertName) {
    if (status === "ended") {
      onSessionEnded();
      return;
    }
    if (status === "active") {
      setBanner(
        (expertName ? expertName : "An expert") +
          " is in the chat and working on your machine.",
        "ok",
      );
      return;
    }
    setBanner(WAITING_COPY);
  }

  /* ── Relay messages ── */

  function handleRelay(msg) {
    switch (msg.type) {
      case "hello-ok": {
        setConn("online", "Connected");
        clearMessages();
        const history = Array.isArray(msg.history) ? msg.history : [];
        const activity = Array.isArray(msg.activity) ? msg.activity : [];
        // Interleave chat and expert actions by timestamp so the log reads in
        // the order things actually happened.
        const feed = [
          ...history.map((m) => ({ at: m.at || 0, chat: m })),
          ...activity.map((a) => ({ at: a.at || 0, activity: a })),
        ].sort((x, y) => x.at - y.at);
        for (const f of feed) {
          if (f.chat) renderMessage(f.chat);
          else renderActivity(f.activity);
        }
        applyStatus(msg.status, msg.expertName);
        return;
      }
      case "hello-failed":
        onHelloFailed();
        return;
      case "chat":
        if (!ended) renderMessage(msg.message);
        return;
      case "activity":
        if (!ended) renderActivity(msg.entry);
        return;
      case "expert-joined":
        if (!ended) applyStatus("active", msg.expertName);
        return;
      case "expert-left":
        if (!ended) {
          setBanner(
            "The expert left the chat. You're back in the queue — messages you send will be delivered when an expert joins.",
          );
        }
        return;
      case "session-ended":
        onSessionEnded();
        return;
      default:
        return; // unknown message types are ignored
    }
  }

  /* ── Connection lifecycle ── */

  function wsUrl() {
    return location.origin.replace(/^http/, "ws") + "/customer";
  }

  function scheduleReconnect() {
    if (ended || failed || reconnectTimer !== null) return;
    setConn("error", "Reconnecting…");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function connect() {
    if (ended || failed) return;
    setConn("", "Connecting…");
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
      if (msg && typeof msg.type === "string") handleRelay(msg);
    });

    socket.addEventListener("close", () => {
      if (ws === socket) ws = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // The close event follows and drives the reconnect.
    });
  }

  /* ── Sending (no optimistic render — wait for the echo) ── */

  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (ended || failed) return;
    const text = els.input.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", text: text.slice(0, 2000) }));
    els.input.value = "";
    els.input.focus();
  });

  connect();
})();
