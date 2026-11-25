# Cachet server (API, Telegram bot, x402 facilitator, anchoring worker) for Railway.
# Build from the REPOSITORY ROOT: docker build -f apps/server/Dockerfile .
FROM node:24-bookworm-slim

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app
COPY . .
# Only the server and the workspace packages it uses; no dev tools. pnpm comes from "packageManager".
RUN pnpm install --frozen-lockfile --prod --filter @cachet/server...

ENV NODE_ENV=production
WORKDIR /app/apps/server
USER node
EXPOSE 8787
# Migrations run at start. Secrets come from Railway variables (never from the image).
CMD ["node", "--import", "tsx", "src/index.ts"]
