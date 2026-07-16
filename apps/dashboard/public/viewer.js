// Pure viewer logic for the expert workspace — no DOM, no network.
//
// Everything here is a plain function over plain data so it runs in the
// browser (as a classic script, published on `window.GaeViewer`) and under
// vitest in Node (published on `globalThis.GaeViewer` / `module.exports`).
// app.js owns all rendering; this file owns the decisions:
//   - buildTree:        flat `list_files` entries -> nested explorer tree
//   - viewerMode:       filename -> "markdown" | "html" | "code" | "text"
//   - languageFor:      filename -> highlight.js language (or null)
//   - tab helpers:      open/focus/close on an immutable tab-state object
//   - contextFilePath:  find the auto-open .get-an-expert/CONTEXT.md entry
(function () {
  "use strict";

  /** The context file Phase 2 writes; auto-opened as the first tab. */
  var CONTEXT_FILE = ".get-an-expert/CONTEXT.md";

  /* ── path helpers ─────────────────────────────────────────────────── */

  function normalizePath(path) {
    return String(path == null ? "" : path)
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
  }

  function baseName(path) {
    var norm = normalizePath(path);
    var idx = norm.lastIndexOf("/");
    return idx === -1 ? norm : norm.slice(idx + 1);
  }

  function extension(filename) {
    var name = baseName(filename);
    var idx = name.lastIndexOf(".");
    if (idx <= 0) return ""; // no extension, or a dotfile like ".env"
    return name.slice(idx + 1).toLowerCase();
  }

  /* ── file tree ────────────────────────────────────────────────────── */

  /**
   * Build a nested tree from the flat, recursive `list_files` result.
   *
   * @param entries Array of `{ path, type: "dir"|"file", size? }` (plain path
   *   strings are tolerated and treated as files). Paths are relative to the
   *   project root; either separator is accepted.
   * @returns Array of nodes `{ name, path, type, size?, children? }`, sorted
   *   directories-first then alphabetically (case-insensitive) at every level.
   *   Intermediate directories are created even without an explicit dir entry.
   */
  function buildTree(entries) {
    var root = { children: Object.create(null) };

    function ensureDir(parts) {
      var node = root;
      var prefix = "";
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        prefix = prefix ? prefix + "/" + part : part;
        var child = node.children[part];
        if (!child || child.type !== "dir") {
          child = { name: part, path: prefix, type: "dir", children: Object.create(null) };
          node.children[part] = child;
        }
        node = child;
      }
      return node;
    }

    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var entry = typeof raw === "string" ? { path: raw, type: "file" } : raw;
      if (!entry || typeof entry.path !== "string") continue;
      var norm = normalizePath(entry.path);
      if (!norm || norm === ".") continue;
      var parts = norm.split("/").filter(Boolean);
      if (parts.length === 0) continue;

      if (entry.type === "dir") {
        ensureDir(parts);
        continue;
      }
      var parent = ensureDir(parts.slice(0, -1));
      var name = parts[parts.length - 1];
      if (!parent.children[name]) {
        var node = { name: name, path: parts.join("/"), type: "file" };
        if (typeof entry.size === "number") node.size = entry.size;
        parent.children[name] = node;
      }
    }

    function toSorted(node) {
      var out = [];
      for (var key in node.children) {
        var child = node.children[key];
        if (child.type === "dir") {
          out.push({ name: child.name, path: child.path, type: "dir", children: toSorted(child) });
        } else {
          var file = { name: child.name, path: child.path, type: "file" };
          if (typeof child.size === "number") file.size = child.size;
          out.push(file);
        }
      }
      out.sort(function (a, b) {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    }

    return toSorted(root);
  }

  /** Find the session context file in a `list_files` entries array, or null. */
  function contextFilePath(entries) {
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var entry = typeof raw === "string" ? { path: raw, type: "file" } : raw;
      if (!entry || typeof entry.path !== "string") continue;
      if (entry.type === "file" && normalizePath(entry.path) === CONTEXT_FILE) {
        return CONTEXT_FILE;
      }
    }
    return null;
  }

  /* ── viewer mode + syntax language ────────────────────────────────── */

  // Extension -> highlight.js language. Only languages present in the
  // vendored "common" highlight.js build (see vendor/README.md).
  var LANGUAGE_BY_EXT = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    py: "python", pyw: "python",
    rb: "ruby", gemspec: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin", kts: "kotlin",
    swift: "swift",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
    m: "objectivec", mm: "objectivec",
    cs: "csharp",
    php: "php",
    pl: "perl", pm: "perl",
    lua: "lua",
    r: "r",
    sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
    ps1: "shell",
    json: "json", jsonc: "json", json5: "json", map: "json",
    yml: "yaml", yaml: "yaml",
    toml: "ini", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini",
    css: "css", scss: "scss", less: "less",
    xml: "xml", svg: "xml", xhtml: "xml", vue: "xml", plist: "xml",
    html: "xml", htm: "xml",
    md: "markdown", markdown: "markdown",
    sql: "sql",
    graphql: "graphql", gql: "graphql",
    diff: "diff", patch: "diff",
    mk: "makefile",
    lock: "yaml",
  };

  // Well-known extensionless / dotfile names.
  var LANGUAGE_BY_NAME = {
    makefile: "makefile",
    gnumakefile: "makefile",
    dockerfile: "bash", // no dockerfile grammar in the common build; bash reads well
    gemfile: "ruby",
    rakefile: "ruby",
    ".babelrc": "json",
    ".eslintrc": "json",
    ".prettierrc": "json",
    ".npmrc": "ini",
    ".gitattributes": "ini",
    ".editorconfig": "ini",
    ".env": "ini",
    ".bashrc": "bash",
    ".zshrc": "bash",
    ".profile": "bash",
  };

  /**
   * highlight.js language for a filename, or null when unknown (in which case
   * the viewer falls back to plain text).
   */
  function languageFor(filename) {
    var name = baseName(filename).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LANGUAGE_BY_NAME, name)) {
      return LANGUAGE_BY_NAME[name];
    }
    var ext = extension(filename);
    if (ext && Object.prototype.hasOwnProperty.call(LANGUAGE_BY_EXT, ext)) {
      return LANGUAGE_BY_EXT[ext];
    }
    return null;
  }

  /**
   * How the viewer should present a file:
   *   "markdown" — rendered via marked, with a Rendered/Source toggle
   *   "html"     — sandboxed iframe preview, with a Preview/Source toggle
   *   "code"     — syntax-highlighted source
   *   "text"     — plain text (unknown extension)
   */
  function viewerMode(filename) {
    var ext = extension(filename);
    if (ext === "md" || ext === "markdown") return "markdown";
    if (ext === "html" || ext === "htm") return "html";
    return languageFor(filename) ? "code" : "text";
  }

  /* ── tab state (immutable) ────────────────────────────────────────── */
  //
  // Tab state is a plain object `{ tabs: [{ path }], active: path|null }`.
  // Every helper returns a NEW state object and never mutates its input.

  function emptyTabState() {
    return { tabs: [], active: null };
  }

  function hasTab(state, path) {
    return state.tabs.some(function (t) { return t.path === path; });
  }

  /** Open `path` (dedupes: an already-open tab is focused, not duplicated). */
  function openTab(state, path) {
    if (hasTab(state, path)) return focusTab(state, path);
    return { tabs: state.tabs.concat([{ path: path }]), active: path };
  }

  /** Focus an open tab; no-op (same state back) if it isn't open. */
  function focusTab(state, path) {
    if (!hasTab(state, path) || state.active === path) return state;
    return { tabs: state.tabs.slice(), active: path };
  }

  /**
   * Close a tab. Closing the active tab focuses its right neighbor, falling
   * back to the left one; closing the last tab leaves nothing active.
   */
  function closeTab(state, path) {
    var idx = state.tabs.findIndex(function (t) { return t.path === path; });
    if (idx === -1) return state;
    var tabs = state.tabs.filter(function (t) { return t.path !== path; });
    var active = state.active;
    if (active === path) {
      active = tabs.length === 0 ? null : tabs[Math.min(idx, tabs.length - 1)].path;
    }
    return { tabs: tabs, active: active };
  }

  /* ── export (browser global + CommonJS for vitest) ────────────────── */

  var GaeViewer = {
    CONTEXT_FILE: CONTEXT_FILE,
    normalizePath: normalizePath,
    baseName: baseName,
    extension: extension,
    buildTree: buildTree,
    contextFilePath: contextFilePath,
    languageFor: languageFor,
    viewerMode: viewerMode,
    emptyTabState: emptyTabState,
    openTab: openTab,
    focusTab: focusTab,
    closeTab: closeTab,
  };

  if (typeof window !== "undefined") window.GaeViewer = GaeViewer;
  else if (typeof globalThis !== "undefined") globalThis.GaeViewer = GaeViewer;
  if (typeof module !== "undefined" && module.exports) module.exports = GaeViewer;
})();
