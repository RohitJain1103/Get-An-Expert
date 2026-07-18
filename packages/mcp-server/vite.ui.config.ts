import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One config, two entries: `vite build --config vite.ui.config.ts --mode consent`
// and `--mode status`. Named vite.ui.config.ts, not vite.config.ts, so vitest
// does not auto-load it and inherit the ui/ root.
// Each build inlines its JS/CSS into a single HTML file (the MCP Apps iframe
// is sandboxed and cannot load external assets), written to dist/ui/ where
// src/ui.ts picks it up at runtime. Run after tsup (whose --clean wipes dist).
export default defineConfig(({ mode }) => {
  const card = mode === "status" ? "status" : "consent";
  return {
    root: path.resolve(__dirname, "ui"),
    plugins: [viteSingleFile()],
    build: {
      outDir: path.resolve(__dirname, "dist/ui"),
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(__dirname, "ui", `${card}.html`),
      },
    },
  };
});
