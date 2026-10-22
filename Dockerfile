# DeskForge — one image for the web app and the background worker.
# Business config, branding, uploads and database data live OUTSIDE the image
# (mounted volumes), so upgrading is "pull new image, restart".

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build
# Drop dev-only packages from the runtime copy (tsx and prisma CLI stay: worker + migrations need them).
RUN npm prune --omit=dev --no-audit --no-fund && npm install --no-save --no-audit --no-fund tsx prisma@7.10.1 dotenv

# No OS packages needed: Prisma 7 has no native engine, busybox provides wget for
# the healthcheck, compose's `init: true` reaps processes, and backups run pg_dump
# inside the postgres container.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    BUSINESS_CONFIG_PATH=/app/config/business.config.yaml \
    BRANDING_DIR=/app/config/branding \
    STORAGE_LOCAL_PATH=/app/storage

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/branding ./default-branding
COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts /app/next.config.ts /app/tsconfig.json /app/postcss.config.mjs ./

RUN mkdir -p /app/storage /app/config && chown -R node:node /app/storage /app/config
USER node
EXPOSE 3000

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["web"]
