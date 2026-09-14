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
USER node
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
