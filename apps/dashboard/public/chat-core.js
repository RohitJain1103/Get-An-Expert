// Pure chat logic for the standalone customer page. No DOM, no network.
//
// Everything here is a plain function over plain data so it runs in the
// browser (as a classic script, published on `window.GaeChat`) and under
// vitest in Node (published on `globalThis.GaeChat` / `module.exports`).
// chat.js owns all rendering and the WebSocket; this file owns the decisions:
//   - parseLink:    "#<sessionId>.<token>" -> { sessionId, token }
//   - initials:     "Iñigo Fernández" -> "IF"
//   - firstName:    "Rohit Jain" -> "Rohit"
//   - validProfile: guards a PublicExpertProfile off the wire
//   - reduce:       pure state machine driven by relay messages
(function () {
  "use strict";

  /* ── Link parsing: <sessionId>.<token>, split on the FIRST dot ──────── */

  function parseLink(hash) {
    var raw = hash && hash.charAt(0) === "#" ? hash.slice(1) : hash || "";
    var dot = raw.indexOf(".");
    if (dot <= 0 || dot === raw.length - 1) return undefined;
    return { sessionId: raw.slice(0, dot), token: raw.slice(dot + 1) };
  }

  /* ── Name helpers ───────────────────────────────────────────────────── */

  function words(name) {
    return String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
  }

  function initials(name) {
    var w = words(name);
    if (w.length === 0) return "";
    var first = w[0].charAt(0);
    var last = w.length > 1 ? w[w.length - 1].charAt(0) : "";
    return (first + last).toUpperCase();
  }

  function firstName(name) {
    var w = words(name);
    return w.length === 0 ? "" : w[0];
  }

  /* ── Profile guard ──────────────────────────────────────────────────── */

  // A PublicExpertProfile arriving off the wire. Render code refuses anything
  // this rejects, so a malformed card never reaches the trust moment.
  function validProfile(p) {
    return (
      !!p &&
      typeof p === "object" &&
      typeof p.id === "string" &&
      p.id.length > 0 &&
      typeof p.name === "string" &&
      p.name.length > 0 &&
      typeof p.photo === "string" &&
      p.photo.length > 0 &&
      typeof p.role === "string" &&
      typeof p.rating === "number" &&
      Array.isArray(p.companies)
    );
  }

  /* ── State machine ──────────────────────────────────────────────────── */

  // phase: "waiting" | "claimed" | "done" | "ended" | "failed"
  // "done" is the accepted-delivery payoff screen; the session is still active
  // (accepting never ends or revokes), the phase just drives the celebration.
  // The renderer reads this; the WebSocket handler only dispatches messages.
  function initialState() {
    return {
      phase: "waiting",
      expert: undefined,
      expertName: undefined,
      bench: [],
      permissions: undefined,
      issue: undefined,
      manifest: undefined,
      // The delivery record: { summary, at, respondedAt?, accepted?, rating? }.
      // A pending (unresponded) delivery shows the delivery card; accepted moves
      // to the done screen; declined keeps working with no card.
      delivery: undefined,
      feed: [],
    };
  }

  /* ── Delivery normalisation: accept only a plausibly-shaped record off the
     wire, so a malformed frame never fabricates a card. A "delivered" message
     carries { summary, at }; the stored record may also carry respondedAt /
     accepted / rating. ──────────────────────────────────────────────────── */

  function normalizeDelivery(d) {
    if (!d || typeof d !== "object" || typeof d.summary !== "string") {
      return undefined;
    }
    var out = {
      summary: d.summary,
      at: typeof d.at === "number" ? d.at : 0,
    };
    if (typeof d.respondedAt === "number") out.respondedAt = d.respondedAt;
    if (typeof d.accepted === "boolean") out.accepted = d.accepted;
    if (typeof d.rating === "number") out.rating = d.rating;
    return out;
  }

  /* ── Context chips: the two always-true chips, with count-bearing chips
     interleaved only when the manifest actually carries a number. A number
     (including 0) renders; an absent or non-number field shows no chip, so a
     count is never fabricated. Order matches the visual spec. ────────────── */

  function contextChips(manifest) {
    var m = manifest || {};
    var chips = ["Your agent's summary"];
    if (typeof m.conversationMessages === "number") {
      chips.push("This conversation, " + m.conversationMessages + " messages");
    }
    chips.push("A short overview of your project");
    // Only surface the redaction chip when something was actually removed:
    // "0 secrets removed" reads as a warning that there might have been some,
    // which is the opposite of the reassurance it is meant to give.
    if (typeof m.secretsRedacted === "number" && m.secretsRedacted >= 1) {
      chips.push(m.secretsRedacted + " secrets removed");
    }
    return chips;
  }

  function phaseFromStatus(status) {
    if (status === "ended") return "ended";
    if (status === "active") return "claimed";
    return "waiting";
  }

  // history (chat) + activity (expert actions) interleaved by timestamp, so
  // the restored feed reads in the order things actually happened.
  function feedFromHello(history, activity) {
    var items = [];
    var h = Array.isArray(history) ? history : [];
    var a = Array.isArray(activity) ? activity : [];
    for (var i = 0; i < h.length; i++) {
      items.push({ kind: "chat", at: (h[i] && h[i].at) || 0, message: h[i] });
    }
    for (var j = 0; j < a.length; j++) {
      items.push({ kind: "activity", at: (a[j] && a[j].at) || 0, entry: a[j] });
    }
    items.sort(function (x, y) {
      return x.at - y.at;
    });
    return items;
  }

  function reduce(state, msg) {
    var s = state || initialState();
    if (!msg || typeof msg.type !== "string") return s;

    switch (msg.type) {
      case "hello-ok": {
        var profile = validProfile(msg.expert) ? msg.expert : undefined;
        var delivery = normalizeDelivery(msg.delivery);
        var basePhase = phaseFromStatus(msg.status);
        return {
          // Restore the ending on reload: an accepted delivery lands on the
          // done screen; a pending or declined delivery stays working (the
          // renderer shows the card only while the delivery is unresponded).
          phase:
            delivery && delivery.accepted === true && basePhase !== "ended"
              ? "done"
              : basePhase,
          expert: profile,
          expertName:
            typeof msg.expertName === "string" ? msg.expertName : undefined,
          bench: Array.isArray(msg.bench) ? msg.bench.filter(validProfile) : [],
          permissions: msg.permissions,
          issue: typeof msg.issue === "string" ? msg.issue : undefined,
          manifest: msg.contextManifest,
          delivery: delivery,
          feed: feedFromHello(msg.history, msg.activity),
        };
      }

      case "hello-failed":
        return assign(s, { phase: "failed" });

      case "expert-joined": {
        if (s.phase === "ended" || s.phase === "failed") return s;
        return assign(s, {
          phase: "claimed",
          expert: validProfile(msg.expert) ? msg.expert : undefined,
          expertName:
            typeof msg.expertName === "string" ? msg.expertName : undefined,
        });
      }

      case "expert-left": {
        if (s.phase === "ended" || s.phase === "failed") return s;
        return assign(s, {
          phase: "waiting",
          expert: undefined,
          expertName: undefined,
        });
      }

      case "chat": {
        if (s.phase === "ended" || s.phase === "failed" || !msg.message) return s;
        return assign(s, {
          feed: s.feed.concat([
            { kind: "chat", at: (msg.message && msg.message.at) || 0, message: msg.message },
          ]),
        });
      }

      case "activity": {
        if (s.phase === "ended" || s.phase === "failed" || !msg.entry) return s;
        return assign(s, {
          feed: s.feed.concat([
            { kind: "activity", at: (msg.entry && msg.entry.at) || 0, entry: msg.entry },
          ]),
        });
      }

      case "issue-updated": {
        // Every accepted edit (ours or the expert's) echoes back here; the
        // echo is the single render path, so the card never updates optimistically.
        if (s.phase === "ended" || s.phase === "failed") return s;
        return assign(s, {
          issue: typeof msg.issue === "string" ? msg.issue : s.issue,
        });
      }

      case "edit-rejected":
        // The customer always wins, so a customer socket never receives this;
        // the case keeps reduce total and leaves the issue untouched.
        return s;

      case "delivered": {
        // The expert marked the work done. Phase stays working-like (claimed);
        // the unresponded delivery drives the delivery card. A fresh deliver
        // after a decline or accept replaces the previous one.
        if (s.phase === "ended" || s.phase === "failed") return s;
        var d = normalizeDelivery(msg);
        if (!d) return s;
        return assign(s, { phase: "claimed", delivery: d });
      }

      case "delivery-accepted": {
        // "Yes, that solved it": the payoff screen. The session stays active
        // (accepting never ends or revokes); only the phase changes.
        if (s.phase === "ended" || s.phase === "failed") return s;
        var acc = assign(s.delivery || { summary: "", at: 0 }, {
          respondedAt: typeof msg.at === "number" ? msg.at : undefined,
          accepted: true,
        });
        return assign(s, { phase: "done", delivery: acc });
      }

      case "delivery-declined": {
        // Blame-free "Not yet": clear the pending card into a plain declined
        // marker and stay working. The renderer reopens the composer.
        if (s.phase === "ended" || s.phase === "failed") return s;
        var dec = s.delivery
          ? assign(s.delivery, {
              respondedAt: typeof msg.at === "number" ? msg.at : undefined,
              accepted: false,
            })
          : undefined;
        return assign(s, { phase: "claimed", delivery: dec });
      }

      case "rated":
        // The rating rides to the expert only; a customer socket never receives
        // this. The case keeps reduce total.
        return s;

      case "session-ended":
        return assign(s, { phase: "ended" });

      default:
        return s; // unknown message types leave state unchanged
    }
  }

  /* ── Edit payload: trim, bound 1..2000, wrap as an edit-issue message ── */

  function editPayload(text) {
    if (typeof text !== "string") return undefined;
    var trimmed = text.trim();
    if (trimmed.length === 0) return undefined;
    return { type: "edit-issue", text: trimmed.slice(0, 2000) };
  }

  /* ── Delivery response + rating payloads (validated) ────────────────────
     canRate gates the optional star row: it appears only after an accepted
     delivery, and only until a rating exists (one time, per decision). ──── */

  function canRate(state) {
    var s = state || {};
    var d = s.delivery;
    return (
      s.phase === "done" &&
      !!d &&
      d.accepted === true &&
      (d.rating === undefined || d.rating === null)
    );
  }

  function deliveryResponsePayload(accepted) {
    return { type: "delivery-response", accepted: accepted === true };
  }

  function ratePayload(n) {
    if (typeof n !== "number" || !isFinite(n)) return undefined;
    var r = Math.round(n);
    if (r < 1 || r > 5) return undefined;
    return { type: "rate", rating: r };
  }

  /* ── End session two-step confirm state machine ─────────────────────────
     Ending is destructive and irreversible, so a first tap only arms the
     confirm; "confirm" is honoured only from the armed step, so a stray click
     can never end a session. "cancel" (Keep going / Esc) returns to idle.
     Steps: "idle" -> "armed" -> "ending". ──────────────────────────────── */

  function nextEndStep(step, action) {
    var s = step || "idle";
    if (action === "arm") return "armed";
    if (action === "cancel") return "idle";
    if (action === "confirm") return s === "armed" ? "ending" : s;
    return s;
  }

  // Shallow immutable update: never mutate the state the caller handed us.
  function assign(state, patch) {
    var next = {};
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
    }
    for (var p in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
    }
    return next;
  }

  /* ── export (browser global + CommonJS for vitest) ──────────────────── */

  var GaeChat = {
    parseLink: parseLink,
    initials: initials,
    firstName: firstName,
    validProfile: validProfile,
    reduce: reduce,
    editPayload: editPayload,
    contextChips: contextChips,
    nextEndStep: nextEndStep,
    canRate: canRate,
    deliveryResponsePayload: deliveryResponsePayload,
    ratePayload: ratePayload,
    initialState: initialState,
  };

  if (typeof window !== "undefined") window.GaeChat = GaeChat;
  else if (typeof globalThis !== "undefined") globalThis.GaeChat = GaeChat;
  if (typeof module !== "undefined" && module.exports) module.exports = GaeChat;
})();
