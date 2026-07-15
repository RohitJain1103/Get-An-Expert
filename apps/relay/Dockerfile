# Get An Expert relay — signaling server + expert dashboard.
# Lightweight: the relay itself depends only on `ws` and `zod`. It serves the
# static expert dashboard from apps/dashboard/public.
#
# Build context is the repository root (see railway.json / dockerfilePath).
FROM node:20-slim

RUN corepack enable
WORKDIR /app

# Copy the workspace and install. --ignore-scripts skips the agent's native
# prebuilds (node-datachannel / node-pty) — the relay never imports them, so
# there's no toolchain or binary download in this image.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
 && pnpm --filter get-an-expert-relay build

# Bind to all interfaces so the platform proxy can reach it. Railway injects
# PORT; the relay reads it. Set GET_AN_EXPERT_EXPERT_TOKENS in the service env.
ENV GET_AN_EXPERT_HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "apps/relay/dist/index.js"]
