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
  const CTX_SAVED = "Updated. The expert sees this now.";
  // The context chips (including the count-bearing "This conversation, N
  // messages" and "N secrets removed") are built by GaeChat.contextChips from
  // the manifest the relay carries, so a count is shown only when it is real.
  const STEPS_HEADING = "What happens next";
  const STEPS = [
    "One expert picks this up.",
    "You'll see exactly who.",
    "Every action they take shows here, live.",
  ];
  const STEPS_FOOT =
    "Close this tab anytime. Your place in the queue holds, and this link brings you back.";
  const BENCH_HEADING = "Experts on bench";
  const BENCH_MORE = "+100 more experts";
  // Delivery + accepted copy, verbatim from the locked visual spec.
  const DELIVER_TITLE = (first) => first + " delivered the fix";
  const DELIVER_YES = "Yes, that solved it";
  const DELIVER_NO = "Not yet";
  const DECLINE_PLACEHOLDER = (first) => "Tell " + first + " what's missing";
  const DONE_BANNER = "All done.";
  const DONE_TITLE = "Fixed and confirmed";
  const DONE_BODY = (first) =>
    first +
    " got you unstuck. This chat stays at this link if you need the summary again. Now go build.";
  const DONE_MINI = (name) => name + " fixed this for you.";
  const ENDED_MINI = (name) => name + " worked on this session.";
  const RATE_LABEL = "Optional: rate this session";
  const RATE_THANKS = (first) => "Thanks. Sent to " + first + ".";

  // Short bench labels keyed by expert id (from the spec's EXPERTS.short).
  // Unknown ids fall back to the full tag.
  const BENCH_SHORT = {
    rohit: "Code & APIs",
    aakash: "Deploys",
    senjal: "Design",
    inigo: "AI & agents",
    hardik: "Security",
    pulkit: "GTM",
  };

  // Drawn checkmark, fixed constant markup (no interpolated data), for the
  // delivery ring and the accepted big ring.
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><polyline points="4.5 12.5 10 18 19.5 7"/></svg>';

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

  // Context editor state. ctxMode drives both the waiting context card and the
  // claimed-state ctx-mini row. editDraft survives re-renders (a chat message
  // arriving mid-edit must not wipe what the customer is typing). editorTextarea
  // is the live node so render() can restore focus after rebuilding.
  let ctxMode = "view"; // "view" | "edit" | "saved"
  let editDraft = "";
  let editorTextarea = null;

  // End-session two-step confirm. "idle" shows the End session control; "armed"
  // shows the inline "End session? Yes, end it / Keep going" confirm. Pure
  // transitions live in GaeChat.nextEndStep (tested); this only holds the step.
  let endStep = "idle"; // "idle" | "armed" | "ending"

  // Celebration latches. `celebrated` fires the confetti once per entry into the
  // done screen (an incidental re-render must not re-burst it). `ratedLocally`
  // collapses the star row the instant a star is tapped (the rating is not
  // echoed back, so there is nothing to reduce). Both reset on leaving done.
  let celebrated = false;
  let ratedLocally = false;
  // The phase the feed was last painted for, so render() knows when to replay
  // the staggered entrance (phase change) versus appending quietly.
  let lastPhase = null;

  function armEnd() {
    endStep = G.nextEndStep(endStep, "arm");
    render();
  }

  function cancelEnd() {
    if (endStep !== "armed") return;
    endStep = G.nextEndStep(endStep, "cancel");
    render();
  }

  function confirmEnd() {
    endStep = G.nextEndStep(endStep, "confirm");
    if (endStep === "ending" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end" }));
    }
    endStep = "idle"; // the session-ended echo collapses the pinned region
    render();
  }

  function openEditor() {
    editDraft = state.issue || "";
    ctxMode = "edit";
    render();
  }

  function cancelEditor() {
    ctxMode = "view";
    render();
  }

  function saveEditor(value) {
    const payload = G.editPayload(value);
    if (payload && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      ctxMode = "saved"; // the issue-updated echo repaints the text
    } else {
      ctxMode = "view"; // empty edit or no socket: treat as cancel
    }
    render();
  }

  // The textarea + Save/Cancel, shared by the waiting card and the ctx-mini row.
  // Esc cancels; input is mirrored into editDraft so a re-render keeps it.
  function appendEditor(box) {
    const ta = el("textarea", "c-edit");
    ta.value = editDraft;
    ta.setAttribute("aria-label", "Edit what the expert sees");
    ta.addEventListener("input", () => {
      editDraft = ta.value;
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEditor();
      }
    });
    editorTextarea = ta;
    box.append(ta);
    const acts = el("div", "c-ctx-acts");
    const save = el("button", "c-btn", "Save");
    save.addEventListener("click", () => saveEditor(ta.value));
    const cancel = el("button", "c-btn ghost", "Cancel");
    cancel.addEventListener("click", cancelEditor);
    acts.append(save, cancel);
    box.append(acts);
  }

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
    if (ctxMode === "edit") {
      appendEditor(box);
      return box;
    }
    if (state.issue) box.append(el("div", "c-ctx-issue", state.issue));
    const chips = el("div", "c-chips");
    G.contextChips(state.manifest).forEach((t) => {
      const c = el("span", "c-chip");
      c.append(el("span", "tk", "✓")); // check mark
      c.append(el("span", null, t));
      chips.append(c);
    });
    box.append(chips);
    box.append(el("div", "c-ctx-note", CTX_NOTE));
    if (ctxMode === "saved") {
      const ok = el("div", "c-saved");
      ok.append(el("span", null, "✓"));
      ok.append(el("span", null, CTX_SAVED));
      box.append(ok);
    }
    const acts = el("div", "c-ctx-acts");
    const edit = el("button", "c-btn ghost", "Edit");
    edit.addEventListener("click", openEditor);
    acts.append(edit);
    box.append(acts);
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
    box.append(top);
    const faces = el("div", "c-faces");
    for (const x of list) {
      const f = el("div", "c-face");
      f.append(img(x.photo));
      f.append(el("div", "nm", G.firstName(x.name)));
      f.append(el("div", "sb", BENCH_SHORT[x.id] || x.tag)); // short label
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
    // The +100 tail sits inside the strip, partly under the right-edge fade, so
    // the row reads as the front of a long bench rather than the whole bench.
    faces.append(el("div", "c-more", BENCH_MORE));
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

  // The collapsed mini row. Keeps the expert photo through the ended AND done
  // states (the reducer retains the profile past session-ended), so the avatar
  // never falls back to a broken image glyph. `text` is the state's copy.
  function miniInto(node, text) {
    node.replaceChildren();
    if (state.expert && state.expert.photo) node.append(img(state.expert.photo));
    node.append(el("span", null, text));
  }

  /* ── Delivery card + accepted celebration ──────────────────────────── */

  function deliveryCard() {
    const box = el("div", "c-deliver anim-in");
    const dh = el("div", "dh");
    const ring = el("div", "ring");
    ring.innerHTML = CHECK_SVG; // fixed constant markup, no interpolation
    dh.append(ring);
    dh.append(el("div", "dt", DELIVER_TITLE(G.firstName(expertName()))));
    box.append(dh);
    box.append(el("div", "ds", (state.delivery && state.delivery.summary) || ""));
    const acts = el("div", "dacts");
    const yes = el("button", "c-btn", DELIVER_YES);
    yes.addEventListener("click", () => respondDelivery(true));
    const no = el("button", "c-btn ghost", DELIVER_NO);
    no.addEventListener("click", () => respondDelivery(false));
    acts.append(yes, no);
    box.append(acts);
    return box;
  }

  function respondDelivery(accepted) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // No optimistic render: the delivery-accepted / delivery-declined echo is
    // the single render path (accepting shows the payoff, declining reopens work).
    ws.send(JSON.stringify(G.deliveryResponsePayload(accepted)));
  }

  function doneScreen() {
    const wrap = el("div", "celebrate");
    const canvas = document.createElement("canvas");
    canvas.id = "confetti";
    wrap.append(canvas);
    const done = el("div", "c-done");
    const ring = el("div", "bigring");
    ring.innerHTML = CHECK_SVG;
    done.append(ring);
    done.append(el("div", "dt", DONE_TITLE));
    done.append(el("div", "ds", DONE_BODY(G.firstName(expertName()))));
    if (ratedLocally || G.canRate(state)) done.append(starRow());
    wrap.append(done);
    // One burst per entry into done. confettiBurst honours reduced motion.
    if (!celebrated) {
      celebrated = true;
      requestAnimationFrame(() => confettiBurst(canvas));
    }
    return wrap;
  }

  function starRow() {
    const wrap = el("div", "c-rate-row");
    if (ratedLocally) {
      wrap.append(el("div", "c-rate-thanks", RATE_THANKS(G.firstName(expertName()))));
      return wrap;
    }
    wrap.append(el("div", "c-rate-label", RATE_LABEL));
    const stars = el("div", "c-stars");
    for (let i = 1; i <= 5; i++) {
      const b = el("button", "c-star", "★");
      b.setAttribute("aria-label", i + (i === 1 ? " star" : " stars"));
      b.addEventListener("click", () => sendRating(i));
      stars.append(b);
    }
    wrap.append(stars);
    return wrap;
  }

  function sendRating(n) {
    const payload = G.ratePayload(n);
    if (!payload || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    // The rating is never echoed back, so collapse the row locally now.
    ratedLocally = true;
    render();
  }

  // One confetti burst, brand colours, ~1.4s, skipped under reduced motion.
  // Ported verbatim from the locked visual spec.
  function confettiBurst(canvas) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = (canvas.width = canvas.clientWidth);
    const H = (canvas.height = canvas.clientHeight);
    const COLORS = ["#2F4A38", "#8FB89B", "#8C7136", "#D98A79", "#E8DFC9"];
    const parts = Array.from({ length: 70 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.35,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 7,
      vy: -(3 + Math.random() * 6),
      w: 5 + Math.random() * 4,
      h: 3 + Math.random() * 3,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    }));
    const t0 = performance.now();
    (function tick(t) {
      const dt = (t - t0) / 1400;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - dt);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (dt < 1) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  function accessBodyInto(node, perms) {
    node.replaceChildren();
    if (perms) {
      if (perms.files) node.append(el("span", "c-scope", "Files"));
      if (perms.terminal) node.append(el("span", "c-scope", "Terminal"));
      if (perms.browser) {
        node.append(
          el("span", "c-scope", perms.browserPort ? "Browser :" + perms.browserPort : "Browser"),
        );
      }
    }
    node.append(endControl());
  }

  // The End session control. Destructive and irreversible, so the first tap only
  // arms an inline confirm (no browser confirm() dialog). Copy is exact.
  function endControl() {
    if (endStep === "armed") {
      const wrap = el("div", "c-endconfirm");
      wrap.append(el("span", "q", "End session?"));
      const yes = el("button", "yes", "Yes, end it");
      yes.addEventListener("click", confirmEnd);
      const no = el("button", "no", "Keep going");
      no.addEventListener("click", cancelEnd);
      wrap.append(yes, no);
      return wrap;
    }
    const btn = el("button", "c-endbtn", "End session");
    btn.addEventListener("click", armEnd);
    return btn;
  }

  function ctxMiniInto(node) {
    node.replaceChildren();
    node.classList.toggle("editing", ctxMode === "edit");
    if (ctxMode === "edit") {
      appendEditor(node);
      return;
    }
    node.append(el("span", "t", state.issue || ""));
    const edit = el("button", null, "Edit");
    edit.addEventListener("click", openEditor);
    node.append(edit);
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
    editorTextarea = null;
    // Leaving the done screen clears the celebration + rating latches so a later
    // accepted delivery bursts fresh.
    if (lastPhase === "done" && state.phase !== "done") {
      celebrated = false;
      ratedLocally = false;
    }
    const phaseChanged = state.phase !== lastPhase;
    lastPhase = state.phase;
    renderConn();
    renderBody(phaseChanged);
    // Keep the caret in the editor across rebuilds (a stray relay message must
    // not steal focus from someone mid-edit).
    if (ctxMode === "edit" && editorTextarea) {
      const ta = editorTextarea;
      ta.focus();
      const end = ta.value.length;
      try {
        ta.setSelectionRange(end, end);
      } catch {
        /* not all inputs support selection ranges */
      }
    }
  }

  // Append a single new feed node with the spring-in physics, without replaying
  // the whole feed. Only used when the phase is unchanged (chat/activity while
  // waiting or working).
  function appendFeedItem(item) {
    if (!item) return;
    const node = item.kind === "chat" ? messageNode(item.message) : activityNode(item.entry);
    if (!node) return;
    // Drop the phase-enter class so this new child animates only via msg-in.
    els.messages.classList.remove("phase-enter");
    node.classList.add("anim-in");
    els.messages.append(node);
    els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: "smooth" });
  }

  // Decide whether an incoming relay message appends one node (phase unchanged)
  // or triggers a full, possibly staggered, re-render.
  function dispatchRender(prev, msg) {
    const appendable = msg.type === "chat" || msg.type === "activity";
    const samePhase = state.phase === prev.phase;
    const grewByOne = state.feed.length === prev.feed.length + 1;
    const feedPhase = state.phase === "waiting" || state.phase === "claimed";
    if (appendable && samePhase && grewByOne && feedPhase) {
      appendFeedItem(state.feed[state.feed.length - 1]);
      return;
    }
    render();
    // A blame-free decline reopens the composer and prompts for what is missing.
    if (msg.type === "delivery-declined" && state.phase === "claimed" && !els.input.disabled) {
      els.input.placeholder = DECLINE_PLACEHOLDER(G.firstName(expertName()));
      els.input.focus();
    }
  }

  function renderConn() {
    let label, off;
    if (state.phase === "failed") {
      label = "OFFLINE";
      off = true;
    } else if (state.phase === "ended") {
      label = "ENDED";
      off = true;
    } else if (state.phase === "done") {
      // Accepted: the session is still live (accepting never ends it), so the
      // dot stays on; the label reads COMPLETE to mark the payoff.
      label = "COMPLETE";
      off = false;
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

  function renderBody(phaseChanged) {
    // The staggered entrance replays only on a phase change; appended feed
    // items animate on their own via msg-in.
    els.messages.classList.toggle("phase-enter", !!phaseChanged);
    // The End control only lives in the claimed pinned region; drop any armed
    // confirm the moment the session leaves that state.
    if (state.phase !== "claimed") endStep = "idle";
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

    if (state.phase === "done") {
      // Accepted: pinned collapses to the mini row ("<Name> fixed this for
      // you."), the body becomes the one celebration in the product, and the
      // composer goes quiet. Accepting does NOT end or revoke; the link stays.
      els.pinned.classList.remove("hidden");
      els.pinLabel.classList.add("hidden");
      els.expertCard.classList.add("hidden");
      els.mini.classList.remove("hidden");
      els.ctxMini.classList.add("hidden");
      els.access.classList.add("hidden");
      miniInto(els.mini, DONE_MINI(expertName()));
      setBanner(DONE_BANNER, "");
      els.messages.replaceChildren(doneScreen());
      disableComposer("Session complete");
      return;
    }

    if (state.phase === "ended") {
      els.pinned.classList.remove("hidden");
      els.pinLabel.classList.add("hidden");
      els.expertCard.classList.add("hidden");
      els.mini.classList.remove("hidden");
      els.ctxMini.classList.add("hidden");
      els.access.classList.add("hidden");
      miniInto(els.mini, ENDED_MINI(expertName()));
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
    // Collapsed by default (check it, do not stare at it), but held open while
    // the End session confirm is armed so the confirm stays visible.
    els.access.open = endStep === "armed";
    expertCardInto(els.expertCard, state.expert);
    ctxMiniInto(els.ctxMini);
    accessBodyInto(els.accessBody, state.permissions);
    setBanner(G.firstName(expertName()) + " is here and working on your machine.", "");
    enableComposer("Message your expert");
    const nodes = feedNodes();
    // A delivered-but-unresponded fix shows the delivery card at the foot of the
    // feed. A declined delivery (respondedAt set, accepted false) shows nothing.
    if (state.delivery && state.delivery.respondedAt === undefined) {
      nodes.push(deliveryCard());
    }
    els.messages.replaceChildren(...nodes);
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
      const prev = state;
      state = G.reduce(state, msg);
      dispatchRender(prev, msg);
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

  // Esc restores the armed End session confirm (matches the editor's Esc-cancel).
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && endStep === "armed") {
      event.preventDefault();
      cancelEnd();
    }
  });

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
