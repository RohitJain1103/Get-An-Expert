# Get An Expert: working rules

## The one hard rule: Flow B only. Flow A is archived.

This repo carries two separately published products from two different tracks.
**Only Flow B is live. Flow A is archived and must never be touched going forward.**

| | Flow A (ARCHIVED, do not touch) | Flow B (the product) |
|---|---|---|
| Package | `get-an-expert-mcp` (`packages/mcp-server/`) | `get-an-expert-agent` (`packages/agent/`) |
| Also called | Flow A | onmachine |
| What it does | Sends a redacted summary to a backend and opens a human-to-human chat when a session gets stuck. The expert never touches your project. | A real expert joins your project through scoped, revocable access (files / terminal / browser), works in your directory, and you watch a live activity log. |
| Status | Frozen. Still published and still exercised by `pnpm -r test`, but no new work. | Active. This is the current product. |

**All new work, including all MCP Apps UI / card work, goes in `packages/agent`
(`get-an-expert-agent`).** Do not add features to `packages/mcp-server`. If a task
or an old handoff points you at `packages/mcp-server`, stop: that is Flow A, and the
target is almost certainly `packages/agent` instead.

## Flow B (get-an-expert-agent) at a glance

The onmachine agent is the customer-facing MCP server. It runs inside the user's own
coding tool (Claude Code, Codex, Cursor, Windsurf) over stdio. Its customer-facing tools:

- `request_expert_help`: registers the session and asks the user to approve scopes
  (Files / Terminal / Browser). This is the consent moment. On app-UI hosts it returns
  the consent card (one-click Yes); otherwise a native elicitation prompt, with a
  plain-language `confirm_expert_scopes` fallback for hosts without one.
- `expert_status`: whether an expert joined, approved scopes, and the live activity log.
  Backed by `session.status()` (state, expertProfile, chatUrl, lastDelivery, recentActivity).
- `revoke_access`: revoke one scope or all.
- `end_session`: end and return a summary.
- `/get-an-expert` prompt: slash command that calls `request_expert_help`.

Supporting packages for Flow B: `packages/core` (shared types + secret redaction),
`apps/relay` (signaling), `apps/dashboard` (the expert-side MCP client over WebRTC).

## Standing rules

- No em dashes, no AI-sounding language in any copy or docs. `grep "—"` before shipping.
- Consent-framed copy only. Never "on your machine" / "machine access".
- Brand green is `#2F4A38` (deep muted forest, from midsesh.com). The only brand color.
  Do not brighten it. Dark mode uses a sage `~#7FAE8D` and a lifted forest CTA `~#46704F`.
- Never push to main directly; always open a PR. Never auto-commit or push without being asked.
