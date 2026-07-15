/**
 * One-command local demo: relay + a stand-in customer, so you can be the
 * expert in your browser.
 *
 *   pnpm --filter get-an-expert-agent demo
 *
 * It starts the relay (serving the dashboard) on :8787, a fake dev server on
 * :3000, and registers a customer session as if someone ran /get-an-expert and
 * approved all three scopes. Open the dashboard, claim the session, and work.
 * Every action you take prints here — that's the live log the customer sees.
 */
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "get-an-expert-relay";
import { AgentSession } from "../src/agent-session";

const RELAY_PORT = 8787;
const DEV_PORT = 3000;
const TOKEN = "demo-token";

// 1. Relay, serving the expert dashboard from dashboard/public.
const here = dirname(fileURLToPath(import.meta.url)); // packages/get-an-expert/examples
const dashboardDir = join(here, "..", "..", "..", "apps", "dashboard", "public");
const relay = createRelay({
  expertTokens: [TOKEN],
  dashboardDir,
  log: (line) => console.log(`\x1b[90m[relay] ${line}\x1b[0m`),
});
// Loopback only — this demo grants terminal/file access, so it must never be
// reachable from the network.
relay.server.listen(RELAY_PORT, "127.0.0.1");

// 2. A fake dev server so the Browser scope has something real to reach —
// styled so the expert's real screenshot looks like a landing page.
const HERO_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Gradient Hero</title><style>
  * { margin: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; }
  .hero { min-height: 100vh; display: grid; place-items: center; text-align: center;
    background: linear-gradient(135deg, #F5A623 0%, #A78BFA 50%, #60A5FA 100%); color: #fff; padding: 40px; }
  h1 { font-size: 56px; font-weight: 800; letter-spacing: -1.5px; text-shadow: 0 2px 30px rgba(0,0,0,.15); }
  p { font-size: 20px; margin: 16px 0 28px; opacity: .95; }
  a { display: inline-block; background: #0A0A0E; color: #fff; padding: 14px 32px;
    border-radius: 10px; font-weight: 600; text-decoration: none; font-size: 16px; }
</style></head><body>
  <section class="hero"><div>
    <h1>The best Landing Page</h1>
    <p>Ship a beautiful hero in minutes.</p>
    <a href="#">Get Started</a>
  </div></section>
  <script>console.log("[landing-page] hydrated ok");</script>
</body></html>`;
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(HERO_PAGE);
}).listen(DEV_PORT, "127.0.0.1");

// 3. A stand-in project with the bug from the design doc.
const projectDir = mkdtempSync(join(tmpdir(), "get-an-expert-demo-"));
mkdirSync(join(projectDir, "src", "components"), { recursive: true });
writeFileSync(
  join(projectDir, "src", "components", "Hero.tsx"),
  "import { HeroImage } from '@/assets';\n\n" +
    "export function Hero() {\n  return <section className=\"hero\"><HeroImage /></section>;\n}\n",
);
writeFileSync(join(projectDir, "src", "assets.ts"), "export { HeroImg } from './images';\n");
writeFileSync(join(projectDir, "package.json"), '{\n  "name": "landing-page",\n  "version": "1.0.0"\n}\n');

// 4. The customer: register + grant, then watch the live activity log.
const session = new AgentSession({
  relayUrl: `ws://localhost:${RELAY_PORT}`,
  projectDir,
  customerName: "Jordan Lee",
  onExpertJoined: (name) => console.log(`\n\x1b[32m● Expert "${name}" joined your session.\x1b[0m`),
  onActivity: (e) => console.log(`\x1b[33m  ↳ ${e.summary}\x1b[0m`),
  onSessionEnded: (reason) => {
    console.log(`\n\x1b[31m● Session ended (${reason}). All access revoked.\x1b[0m`);
    process.exit(0);
  },
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void session.end("customer stopped the demo").finally(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  await session.requestExpert(
    "Build failing: TypeScript says HeroImage is not exported from @/assets. Stuck 20 min.",
  );
  session.grant({ files: true, terminal: true, browser: true, browserPort: DEV_PORT });

  console.log(`
\x1b[1mGet An Expert local demo is running.\x1b[0m

  Customer  Jordan Lee  (${projectDir})
  Scopes    Files ✓  Terminal ✓  Browser :${DEV_PORT} ✓

You are the expert. Open the dashboard and connect:

  \x1b[36mhttp://localhost:${RELAY_PORT}/\x1b[0m
    Relay URL     ws://localhost:${RELAY_PORT}
    Expert token  ${TOKEN}
    Your name     (anything, e.g. Priya)

Then click Jordan Lee in the queue to connect peer-to-peer, and try:
  • a command:  cat package.json   (or:  npm run dev)
  • click Hero.tsx in the file browser to read it
  • the real bug:  the import says HeroImage, but assets.ts exports HeroImg
  • Capture the browser to see localhost:${DEV_PORT}

Everything you do prints below (the live log Jordan sees). Ctrl+C to stop.
`);
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
