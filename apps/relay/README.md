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
| `GET_AN_EXPERT_DASHBOARD_DIR` | sibling `apps/dashboard/public` | Static files for the expert dashboard. Omit to disable static serving. |
| `GET_AN_EXPERT_SESSION_MAX_AGE_MS` | `259200000` (72h) | How long a queued request lives before the max-age sweep expires it. Bounds the durable inbox and the window in which a restarted agent can auto-resume approved scopes. |
| `UPSTASH_REDIS_REST_URL` / `KV_REST_API_URL` | *unset* | Upstash/KV REST URL. When set (with the token below), queued requests are persisted so they **survive a relay restart/redeploy**. Unset ⇒ in-memory (requests still survive customer disconnects and auto-resume; only relay-restart survival needs this). |
| `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN` | *unset* | Upstash/KV REST token that pairs with the URL above. |
| `GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID` | *unset* | Cloudflare Realtime TURN key id. With the token below, the relay mints short-lived TURN credentials and serves them from `/api/ice`. See [TURN](#turn-webrtc-relay-fallback). |
| `GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN` | *unset* | Cloudflare Realtime TURN API token (pairs with the key id). |
| `GET_AN_EXPERT_TURN_URLS` / `_TURN_USERNAME` / `_TURN_CREDENTIAL` | *unset* | Static TURN provider (Metered, Twilio, self-hosted coturn) as an alternative to Cloudflare. Comma-separate multiple urls. |
| `GET_AN_EXPERT_ICE_SERVERS` | *unset* | Escape hatch: a full JSON array of RTCIceServer objects, used verbatim. |

## TURN (WebRTC relay fallback)

Files and the terminal ride a peer-to-peer WebRTC link between the expert's
browser and the customer's machine. With **STUN only** (the default) they must
reach each other directly, which a symmetric NAT or strict firewall blocks — the
explorer stays "Not loaded yet" and the terminal is dead, even though the session
shows connected (the relay control channel is unaffected).

A **TURN** server relays the media when a direct path fails. The dashboard pulls
the ICE list from `GET /api/ice` at connect time, so credentials live only on the
relay. TURN on the expert's browser alone is enough — its relay candidate is a
public address the customer's machine can always reach — so **no agent change is
needed**.

**Cloudflare Realtime TURN (recommended, free tier):** create a TURN key in the
Cloudflare dashboard (Realtime → TURN), then set
`GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID` + `GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN`.
The relay mints short-lived credentials on demand (cached, refreshed before
expiry). Any other provider works via the static `GET_AN_EXPERT_TURN_*` vars.
Unset ⇒ STUN-only, identical to the previous behavior.

## Durable inbox (offline requests)

A customer's request no longer disappears when their machine disconnects. When the
agent socket drops (sleep, Wi-Fi blip, editor closed, relay redeploy), the request
stays in the queue marked **offline** — experts see it, and it becomes claimable
again the moment the customer's agent reconnects (which it does automatically). With
Redis configured, offline/waiting requests are also restored into the queue after a
relay restart. The max-age sweep expires anything left unclaimed/offline past
`GET_AN_EXPERT_SESSION_MAX_AGE_MS`.

## Endpoints

- `GET /` — serves the expert dashboard (static).
- `GET /healthz` — `{ ok: true, sessions }`.
- `WS /agent` — a customer's Get An Expert agent registers here.
- `WS /expert` — an expert dashboard authenticates here.

## Deploy (Railway)

The relay is a normal long-lived Node process (WebSockets), so it runs on any
container host. A `Dockerfile` (`apps/relay/Dockerfile`) and `railway.json` are
included; the image stays lightweight because the relay's only dependencies are
`ws`, `zod`, and the pure-HTTP `@upstash/redis` client (no native modules).

1. **New Railway project → Deploy from GitHub repo**, pick this repo. Railway
   reads `railway.json` and builds `apps/relay/Dockerfile`.
2. **Set service variables:**
   - `GET_AN_EXPERT_EXPERT_TOKENS` — comma-separated expert tokens (one per
     expert, e.g. `alice-3f9a,bob-7c2d`). Required in production.
   - `GET_AN_EXPERT_HOST=0.0.0.0` is already set in the Dockerfile; `PORT` is
     injected by Railway. No other config needed.
   - *(Optional)* `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — add an
     Upstash Redis (or Railway KV) to keep queued requests across relay
     restarts/redeploys. Without them the relay runs in-memory; everything except
     relay-restart survival still works.
3. **Generate a public domain** (Settings → Networking). You get
   `https://<name>.up.railway.app`.
4. Experts open `https://<name>.up.railway.app/`, using
   `wss://<name>.up.railway.app` as the Relay URL and their token.
5. Point agents at it with `GET_AN_EXPERT_RELAY_URL=wss://<name>.up.railway.app`
   (or bake it as the agent's default in a release so users need no config).

Railway terminates TLS and proxies WebSocket upgrades, so `wss://` works with no
extra setup. The relay's heartbeat keeps connections alive through the proxy.

## Wire protocol (summary)

**Agent → relay:** `register`, `metadata` (permissions / activity), `signal` (opaque), `end`.
**Expert → relay:** `auth`, `claim`, `release`, `signal` (opaque), `end-session`.
**Relay → clients:** `registered`, `queue`, `claimed`, `claim-failed`, `expert-joined`, `expert-left`, `signal`, `session-ended`.

`signal` payloads are passed through without inspection. Everything else is metadata.

## Self-hosting

The relay has zero external dependencies beyond `ws` and `zod`. A team that wants no third-party involvement can run it on its own box and point every agent at it via `GET_AN_EXPERT_RELAY_URL`. Because it never holds session data, a compromised relay still can't read your files — it can only observe who connected to whom and when.

## License

MIT
