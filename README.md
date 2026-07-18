# Get An Expert

Human expert help for AI coding tools, delivered as an MCP server. When a user is
stuck in Claude Code or Codex, their agent brings in a real human expert who works
right in the project directory, with files, an interactive terminal (they can run
`claude`, `codex`, a dev server, tests), and the browser, through scoped,
consent-based access the user approves and can revoke anytime. The user watches a
live log of every action; data flows straight to the expert over an encrypted peer
to peer tunnel, and the relay never sees files, terminal, or browser. Every expert
is a real human, no AI-generated answers.

## Install

Add the MCP server to your host of choice:

```
# Claude Code
claude mcp add get-an-expert --scope user -- npx -y get-an-expert-agent@latest

# Codex
codex mcp add get-an-expert -- npx -y get-an-expert-agent@latest
```

Then, in any project where you're stuck, ask your agent for a human expert (in
Claude Code, run `/get-an-expert`). Approve the scopes it asks for, Files, Terminal,
and Browser, and your request enters the expert queue. Nothing is accessed or shared
until you approve, everything is logged live, and you can revoke any scope or end the
session anytime.

**Production:** https://get-an-expert.vercel.app · **npm:** `get-an-expert-agent`
(MCP server)

## Install the Claude Code plugin

For one-click setup in Claude Code (no manual `claude mcp add`), install the plugin,
which bundles the agent and adds the `/get-an-expert` command:

```
/plugin marketplace add RohitJain1103/Get-An-Expert
/plugin install get-an-expert-onmachine
```

See `plugins/onmachine/README.md` for details.

## Repo layout

The current product, onmachine, is the agent plus its relay and dashboard:

```
packages/agent/      get-an-expert-agent: the onmachine MCP server (published to npm) that runs inside the user's coding tool
packages/core/       @get-an-expert/core: shared types + secret redaction (runs client- AND server-side)
apps/relay/          get-an-expert-relay: signaling server for session discovery, WebRTC signaling, session metadata. Self-hostable
apps/dashboard/      get-an-expert-dashboard: an MCP client that connects to the agent peer-to-peer over WebRTC
plugins/onmachine/   Claude Code plugin: one-click install of the agent + the /get-an-expert command
.claude-plugin/      Marketplace manifest for /plugin install
```

An earlier track, Flow A, still lives in the repo alongside onmachine. It is
separately published and still exercised by `pnpm -r test`. Rather than putting an
expert in your project directory, it opens a redacted summary and a live human-to-human
chat when a session gets stuck:

```
packages/mcp-server/ get-an-expert-mcp: the Flow A MCP server (published to npm) that offers a human when a session goes in circles, then relays a live chat
packages/chat-cli/   get-an-expert: published CLI for the terminal chat with a human expert (npx get-an-expert chat <requestId>)
apps/web/            Next.js web app: marketing pages, the /api/v1 backend the Flow A server calls, and the privacy/terms/deletion pages
```

## How the flow works

1. **Ask.** In your coding tool, run `/get-an-expert` (or just ask for a human
   expert). The agent calls `request_expert_help` with the context already in your
   conversation and registers the request with the relay, so it enters the expert
   queue. It handles anything from a specific bug to an open-ended "could this be
   better?", so there's no need to reduce your ask to a reproducible failure first.
2. **Approve, nothing before.** The agent asks you to approve three scopes, Files,
   Terminal, and Browser. Where your host supports an inline approval prompt, it
   renders one the assistant cannot answer for you. Where it doesn't, the agent
   relays a plain-language description and `confirm_expert_scopes` finalizes exactly
   what you approve. Nothing is accessed or shared until you approve.
3. **Connect, peer to peer.** Once approved, the expert joins from the dashboard and
   connects straight to the agent over encrypted WebRTC. Your files, terminal, and
   browser data flow peer to peer and never touch the relay; the relay only handles
   the connection handshake and session metadata.
4. **Work, watched.** The expert works in your project directory: reading and editing
   files, running commands in an interactive terminal (they can run `claude`,
   `codex`, a dev server, tests), and viewing the rendered page and console for the
   one localhost port you approved. `expert_status` shows a live log of every action.
5. **Stay in control.** `revoke_access` withdraws any single scope, and the next
   matching action fails at once (revoking Terminal kills a live shell immediately).
   `end_session` revokes everything and returns a summary of what changed. You can
   walk away too: the request stays queued across an editor or agent restart and
   reconnects automatically, re-arming the scopes you approved.

## What you're approving

| Scope | What it allows |
|---|---|
| Files | Read and edit files in the project directory. Files matched by your `.gitignore`, plus a built-in secret denylist, are skipped, so private files and secrets are not opened. |
| Terminal | An interactive shell that opens in the project directory (any command, including AI tools). |
| Browser | View the rendered page, console, and status for the one localhost port you approved. |

Secrets are stripped from the hand-off context shared with the expert, and every
expert works under a signed confidentiality agreement. See `SECURITY.md` for the
full model.

## Development

```bash
pnpm install
pnpm -r test                              # tests across every workspace package (onmachine + Flow A)
pnpm --filter get-an-expert-agent build   # bundle the agent MCP server
pnpm --filter get-an-expert-relay dev     # run the signaling relay locally
```

The agent pulls native modules (`node-datachannel`, `node-pty`) with prebuilt
binaries and uses a Chromium-family browser for the browser view (falling back to an
HTTP check if none is present). Node.js ≥ 18 is required.

## Privacy posture (the short version)

- **Consent first.** Nothing is accessed or shared until you approve, and you can
  revoke any scope instantly. Which path granted access, an inline host prompt or
  your reply in chat, is recorded in the activity log.
- **Peer to peer.** Your files, terminal, and browser data flow directly to the
  expert over encrypted WebRTC. The relay only handles signaling and session
  metadata and never sees them.
- **Scoped.** File access is limited to the project directory and skips `.gitignored`
  and secret files; browser access is pinned to the one localhost port you approved.
- **Visible.** A live log records every action the expert takes (action and target,
  not the file contents or command output themselves).
- **Human.** Every expert is a real, vetted person working under a signed
  confidentiality agreement. No AI-generated answers, and no AI reads your session.
