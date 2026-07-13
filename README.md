# Get An Expert

Human expert helpline for AI coding tools, delivered as an MCP server. When a user is
stuck in Claude Code / Codex / Cursor / Windsurf, their agent offers to bring in
Get An Expert; with the user's explicit consent it sends one redacted session summary
to our API, where a human expert reviews it and responds with a diagnosis plus the
exact prompt to get unstuck. All types of experts, real humans — no AI-generated
answers.

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
4. **Queue.** The API re-redacts, stores with a 30-day TTL, and returns a submission
   confirmation with a deletion link.
5. **Expert response.** Requests land in the passcode-gated dashboard at `/dashboard`,
   where a human expert reviews the summary and writes the response.

## Development

```bash
pnpm install
pnpm -r test          # 41 tests across core, mcp-server, web
pnpm dev:web          # Next.js dev server (in-memory store unless Upstash env set)
pnpm --filter get-an-expert-mcp build   # bundle the MCP server
```

Environment (apps/web): `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash via Vercel
Marketplace), `DASHBOARD_PASSCODE`.

## Deployment

Vercel project `get-an-expert` (root directory `apps/web`). Deploy with
`vercel deploy --prod`. Storage is Upstash for Redis via the Vercel Marketplace.

## Compliance posture (the short version)

- Zero bytes leave the user's machine before explicit, per-request consent.
- Payloads are minimized and fixed-schema; client- and server-side secret redaction.
- Responses are written by human experts — no AI-generated answers to disclose.
- 30-day auto-deletion + self-serve deletion endpoint; delete tokens stored hashed.
- Tool descriptions are pure function statements — no agent-directed nudging (MCP
  directory / scanner requirement); proactive offering lives in server instructions
  and the user-installed plugin hook.
