import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/relay.ts"],
  format: "esm",
  target: "node18",
  // Bundle everything (workspace core included) so the published package has
  // zero runtime dependencies — npx fetches exactly one tarball.
  noExternal: [/(.*)/],
  // relay.js must be fully self-contained: `init` copies that ONE file to
  // ~/.get-an-expert/relay.mjs, where chunk imports would dangle.
  splitting: false,
  clean: true,
});
