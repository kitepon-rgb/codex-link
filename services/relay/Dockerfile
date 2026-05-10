FROM node:22-bookworm-slim

WORKDIR /app
ENV PORT=3000

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mac-host/package.json apps/mac-host/package.json
COPY packages/codex-client/package.json packages/codex-client/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY services/relay/package.json services/relay/package.json

RUN pnpm install --frozen-lockfile

COPY packages/protocol packages/protocol
COPY services/relay services/relay

RUN pnpm --filter @codex-link/relay build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "services/relay/dist/server.js"]
