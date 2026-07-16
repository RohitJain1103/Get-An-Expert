# get-an-expert-dashboard

**The expert's web dashboard.** A queue of people who need help, and a workspace to help them — all running on *their* machine, not yours.

An expert opens this dashboard, signs in with their token, and sees everyone waiting. Clicking a session establishes a direct peer-to-peer WebRTC connection to that person's machine and opens a VS Code-style workspace:

- a **file-explorer sidebar** scoped to the approved directory, with **file tabs** and viewers — rendered markdown (`marked`), sandboxed HTML previews, and syntax-highlighted code (`highlight.js`); the session context file `.get-an-expert/CONTEXT.md` auto-opens as the first tab when present (view-only by design — edits happen through the terminal),
- **multiple interactive terminals** (xterm.js, one dedicated PTY data channel each) — real live shells in the customer's project directory, where the expert can run `claude`, `codex`, a dev server, tests, or any interactive tool,
- a **Browser tab** — an actual screenshot of the customer's dev server, plus console and HTTP status,
- a **Chat tab** — messages with the customer, brokered by the relay so it works after the customer walks away,

plus live **permission chips** showing which scopes the customer has granted, and an **End session** button that revokes everything.

The expert can run any tool installed on the customer's machine through the terminal — including `claude` or `codex`, so an AI helper works in the *real* environment instead of a blind reproduction.

## How it connects

The dashboard is an **MCP client**. It talks to the Get An Expert agent's expert tool surface over a WebRTC data channel, peer-to-peer. The relay is used only to authenticate the expert, list the queue, and carry the connection handshake — the tool calls and their results (files, command output, screenshots) never pass through it.

- **Relay WebSocket** (`/expert`) — auth, queue, claim, signaling, and the customer chat.
- **WebRTC** (browser `RTCPeerConnection`) — data channels to the agent (`node-datachannel` on the other end): `mcp` for tools, plus one `pty`/`pty-N` channel per terminal tab.
- **MCP over the `mcp` channel** — a minimal JSON-RPC client (`mcp-client.js`) that runs `initialize`, `tools/list`, and `tools/call`.
- **PTY over each `pty` channel** — xterm.js streams keystrokes to, and output from, a shell on the customer's machine.

Everything is self-contained static files (`index.html`, `app.js`, `viewer.js`, `styles.css`, `mcp-client.js`, pinned libraries under `vendor/` — see `vendor/README.md`) — no build step, no bundler. The relay serves them from `public/`.

## Run it

Start the relay (it serves this dashboard by default):

```bash
pnpm --filter get-an-expert-relay dev
```

Open `http://localhost:8787/`, enter the relay URL, your expert token, and your name, and connect.

## Tests

`mcp-client.js` (the JSON-RPC client that drives every tool call) and `viewer.js` (the pure workspace logic: file-tree building, viewer-mode detection, tab state) are unit-tested:

```bash
pnpm --filter get-an-expert-dashboard test
```

## License

MIT
