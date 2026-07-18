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

## Repo layout

```
packages/core/         Shared types + secret redaction (runs client- AND server-side)
packages/chat-cli/     Terminal chat + session-relay script (npx get-an-expert chat|init)
packages/mcp-server/   The stdio MCP server published to npm as get-an-expert-mcp
apps/web/              Next.js API + expert dashboard + privacy/terms (Vercel)
plugins/claude-code/   Claude Code plugin: stuck-detection Stop hook + relay hooks + MCP bundle
.claude-plugin/        Marketplace manifest for /plugin install
```

## How the flow works

1. **Detection.** In Claude Code, the plugin's Stop hook counts real user prompts and
   failure signals in the transcript; past thresholds (default 10 prompts + 3 error
   signals) it nudges Claude — max twice per session. In other hosts, the MCP server's
   instructions describe when offering is appropriate.
2. **Consent, once.** `offer_expert_help` renders the offer + consent notice: what's
   sent, what relays while the chat is open, what's never sent, retention, deletion,
   and the controls (/end, /pause). Nothing is transmitted.
3. **Send.** After an explicit yes (plus a native elicitation dialog where supported),
   `request_expert_help` redacts secrets locally and POSTs one structured summary to
   `/api/v1/requests`. The API re-redacts, stores with a 30-day TTL, and mints a
   chat token (returned once, stored hashed — same pattern as the delete token).
4. **Terminal A opens + relay arms.** The MCP server writes the relay flag
   (`~/.get-an-expert/relay.json`), best-effort opens a terminal running
   `npx get-an-expert chat <id>`, and host hooks start relaying session events —
   every payload passes local redaction first, and a RELAY ON indicator shows.
   Cursor/Windsurf wire up via `npx get-an-expert init <host>`.
5. **Live expert chat.** The expert works from the passcode-gated `/dashboard`:
   chat thread with relayed events inline as terminal-style blocks. The user chats
   from Terminal A like texting. Either side can end it — the server then refuses
   further messages and events (410) and the local relay flag self-clears. After the
   chat, `check_expert_replies` lets the agent pull the expert's advice back in.

## Development

```bash
pnpm install
pnpm -r test          # tests across core, chat-cli, mcp-server, web
pnpm dev:web          # Next.js dev server (in-memory store unless Upstash env set)
pnpm --filter get-an-expert-mcp build   # bundle the MCP server
pnpm --filter get-an-expert build       # bundle the chat CLI + relay script
```

Environment (apps/web): `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash via Vercel
Marketplace), `DASHBOARD_PASSCODE`, optional `EXPERT_DISPLAY_NAME`.

## Deployment

Vercel project `get-an-expert` (root directory `apps/web`). Deploy with
`vercel deploy --prod`. Storage is Upstash for Redis via the Vercel Marketplace.

## Compliance posture (the short version)

- Zero bytes leave the user's machine before explicit consent; the chat and the
  session relay run only between "proceed" and the chat's end, and the relay state
  is always visible (RELAY ON indicator, /pause, /end).
- Payloads are minimized and fixed-schema; client- and server-side secret redaction
  on the summary, every chat message (both directions), and every relayed event.
- Responses are written by human experts — no AI-generated answers; no AI ever reads
  the chat.
- 30-day auto-deletion covers the request, its chat, and its relayed events;
  self-serve deletion endpoint; delete and chat tokens stored hashed.
- Tool descriptions are pure function statements — no agent-directed nudging (MCP
  directory / scanner requirement); proactive offering lives in server instructions
  and the user-installed plugin hook.
