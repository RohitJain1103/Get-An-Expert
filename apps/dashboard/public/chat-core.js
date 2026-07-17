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

  // phase: "waiting" | "claimed" | "ended" | "failed"
  // The renderer reads this; the WebSocket handler only dispatches messages.
  function initialState() {
    return {
      phase: "waiting",
      expert: undefined,
      expertName: undefined,
      bench: [],
      permissions: undefined,
      issue: undefined,
      feed: [],
    };
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
        return {
          phase: phaseFromStatus(msg.status),
          expert: profile,
          expertName:
            typeof msg.expertName === "string" ? msg.expertName : undefined,
          bench: Array.isArray(msg.bench) ? msg.bench.filter(validProfile) : [],
          permissions: msg.permissions,
          issue: typeof msg.issue === "string" ? msg.issue : undefined,
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

      case "session-ended":
        return assign(s, { phase: "ended" });

      default:
        return s; // unknown message types leave state unchanged
    }
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
    initialState: initialState,
  };

  if (typeof window !== "undefined") window.GaeChat = GaeChat;
  else if (typeof globalThis !== "undefined") globalThis.GaeChat = GaeChat;
  if (typeof module !== "undefined" && module.exports) module.exports = GaeChat;
})();
