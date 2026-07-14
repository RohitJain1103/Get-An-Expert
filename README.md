# Get An Expert

Human expert helpline for AI coding tools, delivered as an MCP server. When a user is
stuck in Claude Code / Codex / Cursor / Windsurf, their agent offers to bring in
Get An Expert; with the user's explicit consent it opens a private **expert thread**:
one redacted session summary goes to our API, a human expert replies with a diagnosis
plus the exact prompt to get unstuck, and the user keeps talking to that expert from
inside their session until it's solved. All types of experts, real humans — no
AI-generated answers.

**Production:** https://get-an-expert.vercel.app · **npm:** `get-an-expert-mcp`

## Repo layout

```
packages/core/         Shared types + secret redaction (runs client- AND server-side)
packages/mcp-server/   The stdio MCP server published to npm as get-an-expert-mcp
apps/web/              Next.js API + expert dashboard + privacy/terms (Vercel)
plugins/claude-code/   Claude Code plugin: deterministic stuck-detection Stop hook + MCP bundle
.claude-plugin/        Marketplace manifest for /plugin install
```

## How the flow works

1. **Detection.** In Claude Code, the plugin's Stop hook counts real user prompts and
   failure signals in the transcript; past thresholds (default 10 prompts + 3 error
   signals) it nudges Claude — max twice per session. In other hosts, the MCP server's
   instructions describe when offering is appropriate.
2. **Consent.** `offer_expert_help` renders the offer + consent notice (what's sent /
   never sent / retention / deletion). Nothing is transmitted.
3. **Send.** After an explicit yes (plus a native elicitation dialog where supported),
   `request_expert_help` redacts secrets locally and POSTs one structured summary to
   `/api/v1/requests`.
4. **Thread opens.** The API re-redacts, stores with a 30-day TTL, and returns a
   confirmation with a deletion link plus a thread token (stored hashed server-side,
   kept locally at `~/.get-an-expert/thread.json`).
5. **Expert responds.** Requests land in the passcode-gated dashboard at `/dashboard`,
   where a human expert claims the thread, replies, and marks it solved. Replies reach
   the user in-session: the plugin's reply-ping hook nudges Claude when a reply lands
   (`check_expert_messages` relays it), and `message_expert` carries the user's
   follow-ups — with optional progress updates — back to the expert. A message on a
   solved thread reopens it; deletion removes the record and the whole thread.

## Development

```bash
pnpm install
pnpm -r test          # 64 tests across core, mcp-server, web
pnpm dev:web          # Next.js dev server (in-memory store unless Upstash env set)
pnpm --filter get-an-expert-mcp build   # bundle the MCP server
```

Environment (apps/web): `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash via Vercel
Marketplace), `DASHBOARD_PASSCODE`.

## Deployment

Vercel project `get-an-expert` (root directory `apps/web`). Deploy with
`vercel deploy --prod`. Storage is Upstash for Redis via the Vercel Marketplace.

## Compliance posture (the short version)

- Zero bytes leave the user's machine before explicit, per-request consent; thread
  messages and progress updates are sent only when the user asks to send them.
- Payloads are minimized and fixed-schema; client- and server-side secret redaction
  on the summary and on every thread message (both directions).
- Responses are written by human experts — no AI-generated answers to disclose.
- 30-day auto-deletion covers the request and its whole thread; self-serve deletion
  endpoint; delete and thread tokens stored hashed.
- Tool descriptions are pure function statements — no agent-directed nudging (MCP
  directory / scanner requirement); proactive offering lives in server instructions
  and the user-installed plugin hook.
