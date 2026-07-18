import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the consent card UI into a single self-contained HTML file (the MCP
// Apps iframe is sandboxed and cannot load external assets), written to
// dist/ui/ where src/consent-card.ts reads it at runtime. Named
// vite.ui.config.ts, not vite.config.ts, so vitest does not auto-load it and
// inherit the ui/ root. Run after tsup (whose --clean wipes dist).
export default defineConfig({
  root: path.resolve(__dirname, "ui"),
  plugins: [viteSingleFile()],
  build: {
    outDir: path.resolve(__dirname, "dist/ui"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "ui", "consent.html"),
    },
  },
});
