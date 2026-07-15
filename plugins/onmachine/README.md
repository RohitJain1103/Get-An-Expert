# get-an-expert-onmachine (Claude Code plugin)

One-click install for **on-machine expert access**: a real human expert works
directly on your machine — files, an interactive terminal (they can run
`claude`, `codex`, a dev server, tests), and your browser — through scoped,
consent-based, revocable access, peer-to-peer over WebRTC.

This plugin bundles the [`get-an-expert-agent`](https://www.npmjs.com/package/get-an-expert-agent)
MCP server (run via `npx`, no global install) and adds a `/get-an-expert`
command, so there's no manual `claude mcp add`.

## Install

```
/plugin marketplace add RohitJain1103/Get-An-Expert
/plugin install get-an-expert-onmachine
```

Then, in any project where you're stuck:

```
/get-an-expert
```

Approve the scopes it asks for. Your request enters the expert queue; an expert
joins and works in your project while you watch a live log. Revoke any scope or
end the session anytime.

## What you're approving

| Scope | What it allows |
|---|---|
| Files | Read & edit files in the current project directory only |
| Terminal | An interactive shell in that directory (any command, including AI tools) |
| Browser | View the rendered page, console, and status for one localhost port |

Nothing is granted until you approve it, everything is logged live, and the
relay only handles signaling — your files, terminal, and browser data flow
peer-to-peer and never touch it. See the repo's `SECURITY.md`.

## Requirements

Node.js ≥ 18. The agent pulls native modules (`node-datachannel`, `node-pty`)
with prebuilt binaries, and uses a Chromium-family browser for the browser view
(falls back to an HTTP check if none is present).
