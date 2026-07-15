# get-an-expert-dashboard

**The expert's web dashboard.** A queue of people who need help, and a workspace to help them — all running on *their* machine, not yours.

An expert opens this dashboard, signs in with their token, and sees everyone waiting. Clicking a session establishes a direct peer-to-peer WebRTC connection to that person's machine and gives the expert:

- an **interactive terminal** (xterm.js over a dedicated PTY data channel) — a real live shell in the customer's project directory, where the expert can run `claude`, `codex`, a dev server, tests, or any interactive tool,
- a **file browser** scoped to the approved directory,
- a **real browser view** — an actual screenshot of the customer's dev server, plus console and HTTP status,

plus live **permission chips** showing which scopes the customer has granted, and an **End session** button that revokes everything.

The expert can run any tool installed on the customer's machine through the terminal — including `claude` or `codex`, so an AI helper works in the *real* environment instead of a blind reproduction.

## How it connects

The dashboard is an **MCP client**. It talks to the Get An Expert agent's expert tool surface over a WebRTC data channel, peer-to-peer. The relay is used only to authenticate the expert, list the queue, and carry the connection handshake — the tool calls and their results (files, command output, screenshots) never pass through it.

- **Relay WebSocket** (`/expert`) — auth, queue, claim, signaling.
- **WebRTC** (browser `RTCPeerConnection`) — two data channels to the agent (`node-datachannel` on the other end): `mcp` for tools, `pty` for the interactive terminal.
- **MCP over the `mcp` channel** — a minimal JSON-RPC client (`mcp-client.js`) that runs `initialize`, `tools/list`, and `tools/call`.
- **PTY over the `pty` channel** — xterm.js streams keystrokes to, and output from, the shell on the customer's machine.

Everything is self-contained static files (`index.html`, `app.js`, `styles.css`, `mcp-client.js`, vendored `vendor/xterm.*`) — no build step, no bundler. The relay serves them from `public/`.

## Run it

Start the relay (it serves this dashboard by default):

```bash
pnpm --filter get-an-expert-relay dev
```

Open `http://localhost:8787/`, enter the relay URL, your expert token, and your name, and connect.

## Tests

`mcp-client.js` — the JSON-RPC client that drives every tool call — is unit-tested:

```bash
pnpm --filter get-an-expert-dashboard test
```

## License

MIT
