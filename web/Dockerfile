# SM ERP web (Next.js, standalone output). Railway builds this from the web/ directory.
ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Where the API lives on Railway's private network; compiled into the /api/v1 proxy rewrite.
ARG API_INTERNAL_URL
ENV API_INTERNAL_URL=${API_INTERNAL_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
