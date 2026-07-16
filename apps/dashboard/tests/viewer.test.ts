import { describe, expect, it } from "vitest";
// viewer.js is a classic browser script (no ESM syntax). Importing it for its
// side effects publishes the API on globalThis.GaeViewer (window in browsers).
// @ts-expect-error — plain JS shared with the browser
import "../public/viewer.js";

const GaeViewer = (globalThis as any).GaeViewer;
const {
  buildTree,
  contextFilePath,
  viewerMode,
  languageFor,
  emptyTabState,
  openTab,
  focusTab,
  closeTab,
} = GaeViewer;

/* ── buildTree ──────────────────────────────────────────────────────── */

describe("buildTree", () => {
  const entries = [
    { path: "src", type: "dir" },
    { path: "src/b.ts", type: "file", size: 10 },
    { path: "src/a.ts", type: "file" },
    { path: "README.md", type: "file" },
    { path: "src/lib", type: "dir" },
    { path: "src/lib/z.js", type: "file" },
    { path: "app.js", type: "file" },
  ];

  it("nests children under their directories with full paths", () => {
    const tree = buildTree(entries);
    const src = tree.find((n: any) => n.name === "src");
    expect(src.type).toBe("dir");
    const lib = src.children.find((n: any) => n.name === "lib");
    expect(lib.children.map((n: any) => n.path)).toEqual(["src/lib/z.js"]);
    expect(src.children.map((n: any) => n.name)).toEqual(["lib", "a.ts", "b.ts"]);
  });

  it("sorts directories first, then files, alphabetically (case-insensitive)", () => {
    const tree = buildTree(entries);
    expect(tree.map((n: any) => n.name)).toEqual(["src", "app.js", "README.md"]);
  });

  it("creates intermediate directories even without explicit dir entries", () => {
    const tree = buildTree([{ path: "a/b/c.txt", type: "file" }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: "a", type: "dir" });
    expect(tree[0].children[0]).toMatchObject({ name: "b", type: "dir", path: "a/b" });
    expect(tree[0].children[0].children[0]).toMatchObject({
      name: "c.txt",
      type: "file",
      path: "a/b/c.txt",
    });
  });

  it("preserves file sizes and normalizes Windows separators", () => {
    const tree = buildTree([{ path: "src\\deep\\x.ts", type: "file", size: 42 }]);
    const file = tree[0].children[0].children[0];
    expect(file).toMatchObject({ path: "src/deep/x.ts", size: 42 });
  });

  it("ignores junk input and duplicate files", () => {
    const tree = buildTree([
      null,
      { type: "file" },
      { path: "", type: "file" },
      { path: ".", type: "dir" },
      { path: "a.txt", type: "file" },
      { path: "a.txt", type: "file" },
    ] as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe("a.txt");
  });

  it("returns an empty tree for empty or missing input", () => {
    expect(buildTree([])).toEqual([]);
    expect(buildTree(undefined)).toEqual([]);
  });
});

/* ── contextFilePath ────────────────────────────────────────────────── */

describe("contextFilePath", () => {
  it("finds .get-an-expert/CONTEXT.md among the entries", () => {
    const entries = [
      { path: "src/index.ts", type: "file" },
      { path: ".get-an-expert", type: "dir" },
      { path: ".get-an-expert/CONTEXT.md", type: "file" },
    ];
    expect(contextFilePath(entries)).toBe(".get-an-expert/CONTEXT.md");
  });

  it("returns null when absent and ignores dir-typed matches", () => {
    expect(contextFilePath([{ path: "README.md", type: "file" }])).toBeNull();
    expect(contextFilePath([{ path: ".get-an-expert/CONTEXT.md", type: "dir" }])).toBeNull();
    expect(contextFilePath([])).toBeNull();
  });
});

/* ── viewerMode ─────────────────────────────────────────────────────── */

describe("viewerMode", () => {
  it("maps markdown extensions", () => {
    expect(viewerMode("notes.md")).toBe("markdown");
    expect(viewerMode("docs/GUIDE.markdown")).toBe("markdown");
    expect(viewerMode("README.MD")).toBe("markdown");
  });

  it("maps html extensions", () => {
    expect(viewerMode("index.html")).toBe("html");
    expect(viewerMode("legacy.HTM")).toBe("html");
  });

  it("maps known code extensions to code", () => {
    expect(viewerMode("src/app.ts")).toBe("code");
    expect(viewerMode("main.py")).toBe("code");
    expect(viewerMode("styles.css")).toBe("code");
    expect(viewerMode("Makefile")).toBe("code");
  });

  it("falls back to text for unknown or missing extensions", () => {
    expect(viewerMode("data.bin")).toBe("text");
    expect(viewerMode("LICENSE")).toBe("text");
    expect(viewerMode("archive.tar.gz")).toBe("text");
  });
});

/* ── languageFor ────────────────────────────────────────────────────── */

describe("languageFor", () => {
  it("maps extensions to highlight.js languages", () => {
    expect(languageFor("a.js")).toBe("javascript");
    expect(languageFor("a.tsx")).toBe("typescript");
    expect(languageFor("x.py")).toBe("python");
    expect(languageFor("y.rs")).toBe("rust");
    expect(languageFor("z.yml")).toBe("yaml");
    expect(languageFor("q.sql")).toBe("sql");
    expect(languageFor("deep/dir/file.go")).toBe("go");
  });

  it("maps well-known extensionless filenames", () => {
    expect(languageFor("Makefile")).toBe("makefile");
    expect(languageFor("Dockerfile")).toBe("bash");
    expect(languageFor(".npmrc")).toBe("ini");
  });

  it("returns null for unknown files", () => {
    expect(languageFor("photo.jpeg")).toBeNull();
    expect(languageFor("no-extension")).toBeNull();
    expect(languageFor("")).toBeNull();
  });
});

/* ── tab state helpers ──────────────────────────────────────────────── */

describe("tab state", () => {
  it("openTab adds and focuses a new tab", () => {
    const s0 = emptyTabState();
    const s1 = openTab(s0, "a.ts");
    expect(s1.tabs.map((t: any) => t.path)).toEqual(["a.ts"]);
    expect(s1.active).toBe("a.ts");
  });

  it("openTab dedupes on reopen — focuses the existing tab", () => {
    let s = emptyTabState();
    s = openTab(s, "a.ts");
    s = openTab(s, "b.ts");
    s = openTab(s, "a.ts");
    expect(s.tabs.map((t: any) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(s.active).toBe("a.ts");
  });

  it("focusTab focuses an open tab and ignores unknown paths", () => {
    let s = openTab(openTab(emptyTabState(), "a.ts"), "b.ts");
    s = focusTab(s, "a.ts");
    expect(s.active).toBe("a.ts");
    expect(focusTab(s, "nope.ts")).toBe(s);
  });

  it("closeTab keeps the active tab when closing another", () => {
    let s = openTab(openTab(emptyTabState(), "a.ts"), "b.ts");
    s = closeTab(s, "a.ts");
    expect(s.tabs.map((t: any) => t.path)).toEqual(["b.ts"]);
    expect(s.active).toBe("b.ts");
  });

  it("closing the active tab focuses the right neighbor, else the left", () => {
    let s = emptyTabState();
    s = openTab(s, "a.ts");
    s = openTab(s, "b.ts");
    s = openTab(s, "c.ts");
    s = focusTab(s, "b.ts");
    s = closeTab(s, "b.ts"); // right neighbor
    expect(s.active).toBe("c.ts");
    s = closeTab(s, "c.ts"); // last tab active -> left neighbor
    expect(s.active).toBe("a.ts");
  });

  it("closing the only tab clears the active path", () => {
    const s = closeTab(openTab(emptyTabState(), "a.ts"), "a.ts");
    expect(s.tabs).toEqual([]);
    expect(s.active).toBeNull();
  });

  it("closeTab on an unknown path returns the same state", () => {
    const s = openTab(emptyTabState(), "a.ts");
    expect(closeTab(s, "zzz")).toBe(s);
  });

  it("never mutates the input state", () => {
    const s0 = openTab(openTab(emptyTabState(), "a.ts"), "b.ts");
    const frozenTabs = s0.tabs.map((t: any) => ({ ...t }));
    openTab(s0, "c.ts");
    focusTab(s0, "a.ts");
    closeTab(s0, "a.ts");
    expect(s0.tabs).toEqual(frozenTabs);
    expect(s0.active).toBe("b.ts");
  });
});
