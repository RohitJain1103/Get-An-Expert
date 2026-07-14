import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node18",
  // Bundle everything (workspace core included) so the published package has
  // zero runtime dependencies — npx fetches exactly one tarball.
  noExternal: [/(.*)/],
  clean: true,
});
