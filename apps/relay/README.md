# get-an-expert-relay

**The open-source signaling server for Get An Expert.** Self-hostable, and deliberately blind to your data.

The relay does four things:

- **Session discovery** — who's waiting for help, who's connected.
- **WebRTC signaling** — routes the SDP/ICE handshake between a customer's agent and an expert. It forwards these payloads opaquely; it never parses or stores them.
- **Authentication** — verifies experts by token.
- **Session metadata** — duration, granted permissions, and the activity log (action + target only).

It **does not** see file contents, terminal output, or browser data. After the WebRTC handshake completes, all session data flows peer-to-peer between the two machines and never touches this server. That's the whole point of running it: it's the coordination layer, not a data pipe.

## Run it

```bash
# From the monorepo
pnpm --filter get-an-expert-relay dev      # tsx, live reload
pnpm --filter get-an-expert-relay build && pnpm --filter get-an-expert-relay start
```

On startup it prints the port, the dashboard directory it's serving, and — if you didn't set expert tokens — a generated token for the run.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP + WebSocket port. |
| `GET_AN_EXPERT_HOST` | `127.0.0.1` | Bind address. Loopback by default. Set to `0.0.0.0` to accept network connections — only behind your own firewall/auth, since the relay coordinates terminal/file access. |
| `GET_AN_EXPERT_EXPERT_TOKENS` | *generated* | Comma-separated expert auth tokens. If unset, one is generated and printed. |
| `GET_AN_EXPERT_DASHBOARD_DIR` | sibling `get-an-expert-dashboard/public` | Static files for the expert dashboard. Omit to disable static serving. |

## Endpoints

- `GET /` — serves the expert dashboard (static).
- `GET /healthz` — `{ ok: true, sessions }`.
- `WS /agent` — a customer's Get An Expert agent registers here.
- `WS /expert` — an expert dashboard authenticates here.

## Wire protocol (summary)

**Agent → relay:** `register`, `metadata` (permissions / activity), `signal` (opaque), `end`.
**Expert → relay:** `auth`, `claim`, `release`, `signal` (opaque), `end-session`.
**Relay → clients:** `registered`, `queue`, `claimed`, `claim-failed`, `expert-joined`, `expert-left`, `signal`, `session-ended`.

`signal` payloads are passed through without inspection. Everything else is metadata.

## Self-hosting

The relay has zero external dependencies beyond `ws` and `zod`. A team that wants no third-party involvement can run it on its own box and point every agent at it via `GET_AN_EXPERT_RELAY_URL`. Because it never holds session data, a compromised relay still can't read your files — it can only observe who connected to whom and when.

## License

MIT
