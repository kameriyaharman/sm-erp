# SM ERP API — production image (Railway builds this automatically from the repo root).
ARG NODE_VERSION=22.22.0

# ---- 1. production dependencies only, from the lockfile
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- 2. runtime
FROM node:${NODE_VERSION}-alpine AS runtime
# tini: PID 1 that forwards SIGTERM to node, so graceful shutdown runs on redeploys.
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db/migrations ./db/migrations
USER node
# Railway injects PORT; 4000 is only the local default.
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
# node directly (not `npm start`): npm swallows signals and adds noise to the logs.
CMD ["node", "src/server.js"]
