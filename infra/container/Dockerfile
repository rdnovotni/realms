ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY realms/package.json realms/package-lock.json ./
RUN npm ci
COPY realms/tsconfig*.json ./
COPY realms/src ./src
COPY realms/client ./client
RUN npm run build && npm prune --omit=dev
FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="KoL Realms backend"
RUN groupadd -g 10001 kol && useradd -u 10001 -g kol -M kol
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/client/index.html /app/client/styles.css /app/client/welcome.css ./client/
COPY --from=build --chown=10001:10001 /app/client/art ./client/art
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY realms/package.json ./
COPY realms/migrations ./migrations
COPY realms/content ./content
COPY infra/container/*.mjs ./container/
USER 10001:10001
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["node", "container/health.mjs", "/health/live"]
CMD ["node", "container/start.mjs"]
