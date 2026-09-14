# Hosted platforms that cannot pass `--target` (Railway, Render) select the final
# stage with a build argument instead: OPENSTAFF_TARGET=server, web, or allinone.
# OPENSTAFF_USER=root lets platforms whose volumes are root-owned (Render) write /data.
ARG OPENSTAFF_TARGET=server
ARG OPENSTAFF_USER=node
FROM node:22-bookworm AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# Install both the browser and its system dependencies before dropping privileges.
# Run the workspace CLI before pnpm deploy repackages production dependencies.
FROM dependencies AS playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm --filter server exec playwright install --with-deps chromium \
  && test -n "$(find /ms-playwright -maxdepth 1 -name 'chromium-*' -print -quit)" \
  && rm -rf /app

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM dependencies AS server-build
COPY . .
RUN pnpm --filter @openstaff/shared build && pnpm --filter server build

# `pnpm deploy` retains each application's production dependency graph, including
# workspace packages, while leaving development-only dependencies in the builder.
FROM server-build AS server-deps
RUN pnpm --filter server --prod deploy --legacy /server

FROM playwright AS server
WORKDIR /app
LABEL org.opencontainers.image.title="OpenStaff server" \
  org.opencontainers.image.description="OpenStaff Hono server" \
  org.opencontainers.image.source="https://github.com/superworker-ai/open-superworkers"
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright DATA_DIR=/data
COPY --from=server-deps --chown=node:node /server ./
# Browser system packages were installed as root in the cached stage; the
# service itself never is.
RUN mkdir -p /data && chown node:node /data
ARG OPENSTAFF_USER
USER ${OPENSTAFF_USER}
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

FROM build AS web-deps
RUN pnpm --filter web --prod deploy --legacy /web

FROM node:22-bookworm AS web
WORKDIR /app
LABEL org.opencontainers.image.title="OpenStaff web" \
  org.opencontainers.image.description="OpenStaff TanStack Start web application" \
  org.opencontainers.image.source="https://github.com/superworker-ai/open-superworkers"
ENV NODE_ENV=production PORT=3001
COPY --from=web-deps --chown=node:node /web ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]

# One container running Caddy, the server, the web app, and optional Litestream replication.
# For platforms with a single container and ephemeral disk (Cloudflare Containers, Fly, Cloud Run).
# Set S3_* for Cloudflare R2 or another bucket; the entrypoint restores SQLite on boot and
# replicates continuously. Runs as root so the data directory is always writable.
FROM server AS allinone
USER root
LABEL org.opencontainers.image.title="OpenStaff all-in-one" \
  org.opencontainers.image.description="OpenStaff gateway, server, and web in one container with Litestream"
COPY --from=caddy:2.10.2-alpine /usr/bin/caddy /usr/bin/caddy
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=web-deps --chown=node:node /web /web
COPY docker/Caddyfile.hosted /etc/caddy/Caddyfile
COPY docker/litestream-entrypoint.sh docker/allinone-entrypoint.sh /opt/openstaff/
ENV PORT=3000 SERVER_UPSTREAM=127.0.0.1:8787 WEB_UPSTREAM=127.0.0.1:3001 PUBLIC_API_URL=http://127.0.0.1:8787
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["/bin/bash", "/opt/openstaff/allinone-entrypoint.sh"]

FROM ${OPENSTAFF_TARGET} AS final
