# get-an-expert-agent

**On-demand expert assistance where the expert works directly on your machine — through scoped, consent-based, revocable access.**

You're stuck on a bug in Claude Code, Codex, Cursor, or Windsurf. Get An Expert brings a real human expert into your session. They don't screen-share and talk you through keystrokes, and they don't clone your repo to reproduce the bug on their machine. They connect to *your* machine and work in the exact environment where the bug lives — reading files, running commands, checking the browser — inside the scopes you approve, with a live log of every action, and you can revoke access at any time.

This package is the **Get An Expert agent**: an MCP server that runs inside your AI coding tool.

## The idea: the expert goes to the bug

Everything executes on your machine. The expert's dashboard is a remote control — it sends commands and displays output, but runs nothing itself. Zero setup for the expert: no cloning, no dependency install, no Node-version matching. That's the only way an expert can handle many sessions a day.

Data flows **peer-to-peer over WebRTC**, encrypted, directly between the two machines. A relay handles only discovery and the connection handshake — it never sees your files, terminal output, or browser data.

## Install

```bash
npm install -g get-an-expert-agent
```

Then register it as an MCP server in your tool. For Claude Code:

```bash
claude mcp add get-an-expert get-an-expert-agent
```

### Requirements

- **Node.js ≥ 18.**
- Native modules `node-datachannel` (peer-to-peer WebRTC) and `node-pty` (the interactive terminal) — prebuilt binaries are fetched automatically for common platforms; other platforms build from source (needs a C/C++ toolchain).
- A Chromium-family browser (Chrome / Chromium / Edge) for the real browser view. If none is present, the Browser scope falls back to an HTTP reachability check. Point at a specific binary with `GET_AN_EXPERT_BROWSER_EXECUTABLE`.

## Use it

In your existing session, run the slash command:

```
/get-an-expert
```

Your AI calls `request_expert_help`, and you approve — inline, in the same chat — exactly what an expert may do:

- **Files** — read & edit files in your project directory only
- **Terminal** — run commands in your project directory
- **Browser** — view one localhost port (e.g. `localhost:3000`)

Nothing is granted until you approve it. Once you do, you're in the expert queue; when an expert joins they act only within those scopes, and you see every action. `expert_status` shows the live log, `revoke_access` withdraws a scope immediately, and `end_session` closes everything and returns a summary of what changed.

## Tools

**Customer-facing (in your chat):**

| Tool | What it does |
|---|---|
| `request_expert_help` | Registers the session and asks you to approve scopes. |
| `expert_status` | Whether an expert connected + the live activity log. |
| `revoke_access` | Revoke `files`, `terminal`, `browser`, or `all`. |
| `end_session` | End the session, revoke everything, return a summary. |

**Expert-facing (peer-to-peer over WebRTC, gated by your grants):**

An **interactive terminal** — a real shell (PTY) running in your project directory, so the expert can run `claude`, `codex`, a dev server, tests, a REPL, anything, live in the real environment. It streams over its own data channel, is gated by the Terminal scope, and dies the instant you revoke Terminal or end the session. Your log records that a terminal was opened/closed — never the keystrokes or output.

Plus MCP tools: `list_files`, `read_file`, `write_file`, `run_command`, `browser_screenshot`, `browser_console`. Every call passes the permission gate and is logged before it runs.

`browser_screenshot` returns a **real PNG** of your dev server, and `browser_console` returns the page's console output and HTTP status — the expert actually sees the rendered page. This uses a headless Chrome/Chromium/Edge on your machine (via `playwright-core`, no bundled browser download). If no such browser is found, it degrades to an HTTP reachability check (title + status). Point it at a specific binary with `GET_AN_EXPERT_BROWSER_EXECUTABLE` if needed.

## Security model

- **Scoped:** files and terminal are confined to the project directory; path traversal out is refused. Browser access is pinned to the one port you approved.
- **Consent-based:** the scope prompt is a real MCP elicitation in your own client. If your client can't prompt you, nothing is granted (fail-closed).
- **Revocable:** revoking a scope makes the expert's next matching tool call fail immediately.
- **Per-session:** ending the session revokes all access.
- **Visible:** you get a live log of every expert action (action + target — never the file contents or command output themselves).
- **Peer-to-peer:** the relay never sees session data. After the handshake it's out of the loop.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `GET_AN_EXPERT_RELAY_URL` | hosted relay | Relay to register with (`ws://` or `http://`). |
| `GET_AN_EXPERT_PROJECT_DIR` | launch directory | Directory the expert is scoped to. |
| `GET_AN_EXPERT_CUSTOMER_NAME` | OS username | Name shown to the expert in the queue. |
| `GET_AN_EXPERT_BROWSER_PORT` | `3000` | Default dev-server port offered for Browser access. |
| `GET_AN_EXPERT_BROWSER_EXECUTABLE` | *auto* | Path to the Chrome/Chromium/Edge binary used for the Browser scope. Auto-detected when unset. |

## Related

- **get-an-expert-relay** — the open-source, self-hostable signaling server.
- **get-an-expert-dashboard** — the expert's web dashboard (queue, terminal, files, browser).

## License

MIT
