# get-an-expert-onmachine (Claude Code plugin)

One-click install for scoped, consent-based expert help: a real human expert
works in your project directory, with files, an interactive terminal (they can
run `claude`, `codex`, a dev server, tests), and your browser, through access
you approve and can revoke anytime, peer to peer over WebRTC.

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

## Install without the plugin

To add the MCP server directly, or to use it from Codex, paste one of these:

```
# Claude Code
claude mcp add get-an-expert --scope user -- npx -y get-an-expert-agent@latest

# Codex
codex mcp add get-an-expert -- npx -y get-an-expert-agent@latest
```

## What you're approving

| Scope | What it allows |
|---|---|
| Files | Read & edit files in the current project directory only |
| Terminal | An interactive shell in that directory (any command, including AI tools) |
| Browser | View the rendered page, console, and status for one localhost port |

Nothing is accessed or shared until you approve it, everything is logged live,
and the relay only handles signaling; your files, terminal, and browser data
flow peer to peer and never touch it. Secrets are stripped from the shared
context, and every expert works under a signed confidentiality agreement. See
the repo's `SECURITY.md`.

## Proactive offer (opt-out)

The plugin includes a quiet Stop hook (`bin/detect-stuck.mjs`) that runs after
each turn. When a session genuinely looks stuck, many messages with repeated
failure signals, it injects a single line suggesting the assistant may mention
that a human expert can help via `/get-an-expert`. It is deliberately rare: at
most once per session by default, and only past both thresholds.

The hook **sends nothing anywhere**. It only adds a suggestion for the assistant
to weigh. Real access still happens only through `request_expert_help` after your
explicit consent. Every failure path is a silent no-op, so it never breaks a
session.

### Tuning it

All knobs are environment variables:

| Env var | Default | What it controls |
|---|---|---|
| `GAE_MIN_PROMPTS` | `10` | User messages before the offer can fire |
| `GAE_MIN_ERRORS` | `3` | Failure signals ("still broken", "failed") required |
| `GAE_MAX_NUDGES` | `1` | Most offers per session |
| `GAE_RENUDGE_AFTER` | `10` | Extra messages before a repeat (only if max > 1) |

### Turning it off

Set a threshold out of reach, for example `GAE_MIN_PROMPTS=100000`, or remove
the `Stop` entry from `hooks/hooks.json`.

### Testing it

```
node --test plugins/onmachine/bin/detect-stuck.test.mjs
```

## Requirements

Node.js ≥ 18. The agent pulls native modules (`node-datachannel`, `node-pty`)
with prebuilt binaries, and uses a Chromium-family browser for the browser view
(falls back to an HTTP check if none is present).
