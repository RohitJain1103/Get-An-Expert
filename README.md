# Get An Expert

Human expert helpline for AI coding tools, delivered as an MCP server. When a user is
stuck in Claude Code / Codex / Cursor / Windsurf, their agent offers to bring in
Get An Expert; with the user's explicit consent it sends one redacted session summary
to our API and returns a diagnosis plus the exact prompt to get unstuck — AI-assisted
triage today (honestly disclosed), human experts in the loop next.

**Production:** https://get-an-expert.vercel.app · **npm:** `get-an-expert-mcp`

## Repo layout

```
packages/core/         Shared types + secret redaction (runs client- AND server-side)
packages/chat-cli/     Terminal chat with a human expert (npx get-an-expert chat <id>)
packages/mcp-server/   The stdio MCP server published to npm as get-an-expert-mcp
apps/web/              Next.js API + triage engine + dashboard + privacy/terms (Vercel)
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
4. **Triage.** The API re-redacts, stores with a 30-day TTL, runs the Claude-powered
   analysis (Opus 4.8, frozen cached system prompt, structured outputs), and returns a
   humanized, honestly-labeled response with a deletion link.
5. **Review.** Requests land in the passcode-gated dashboard at `/dashboard` for the
   (future) human-expert loop.

## Development

```bash
pnpm install
pnpm -r test          # 34 tests across core, mcp-server, web
pnpm dev:web          # Next.js dev server (in-memory store unless Upstash env set)
pnpm --filter get-an-expert-mcp build   # bundle the MCP server
```

Environment (apps/web): `ANTHROPIC_API_KEY` (triage engine), `KV_REST_API_URL` +
`KV_REST_API_TOKEN` (Upstash via Vercel Marketplace), `DASHBOARD_PASSCODE`.

## Deployment

Vercel project `get-an-expert` (root directory `apps/web`). Deploy with
`vercel deploy --prod`. Storage is Upstash for Redis via the Vercel Marketplace.

## Compliance posture (the short version)

- Zero bytes leave the user's machine before explicit, per-request consent.
- Payloads are minimized and fixed-schema; client- and server-side secret redaction.
- Every response carries an AI disclosure (FTC / CA B.O.T. Act / EU AI Act Art. 50).
- 30-day auto-deletion + self-serve deletion endpoint; delete tokens stored hashed.
- Tool descriptions are pure function statements — no agent-directed nudging (MCP
  directory / scanner requirement); proactive offering lives in server instructions
  and the user-installed plugin hook.
