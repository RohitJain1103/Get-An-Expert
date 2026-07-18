# archive/ — retired code (frozen)

This directory holds the **Flow A** track, an earlier product that has been retired so
the active workspace only contains the current product, **onmachine**
(`packages/agent` + `packages/core` + `apps/relay` + `apps/dashboard` +
`plugins/onmachine`).

Everything here is **frozen**: it is intentionally excluded from the pnpm workspace
(`pnpm-workspace.yaml` globs only `packages/*` and `apps/*`), so it is **not** built,
tested, or published by `pnpm -r build` / `pnpm -r test`, and won't show up next to the
agent where it kept getting confused for the current product. It may be deleted later.

## What's here

| Path | npm package | What it was |
|---|---|---|
| `packages/mcp-server/` | `get-an-expert-mcp` | Flow A MCP server: offered a human when a session went in circles, then relayed a redacted summary + a live human-to-human chat. |
| `packages/chat-cli/` | `get-an-expert` | Terminal chat CLI for that conversation (`npx get-an-expert chat <requestId>`). |
| `plugins/claude-code/` | — | Flow A Claude Code plugin (stuck-detection Stop hook + the `get-an-expert-mcp` bundle). Delisted from `.claude-plugin/marketplace.json`. |

Flow A's HTTP backend (`/api/v1`) still lives in `apps/web/` (not archived), because
that same Next.js app serves the live, product-wide marketing + privacy/terms/deletion
pages at https://get-an-expert.vercel.app.

## Still on npm

Archiving the source does **not** unpublish anything. `get-an-expert-mcp` and
`get-an-expert` remain published; existing installs keep working via `npx`. Nothing new
ships from here unless it is revived.

## Reviving a package

The packages still reference `@get-an-expert/core` via `workspace:*`, which only
resolves inside the workspace. To work on one again, move it back under `packages/`
(e.g. `git mv archive/packages/mcp-server packages/mcp-server`) and run `pnpm install`
from the repo root.
