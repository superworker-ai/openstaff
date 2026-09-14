# Path-routing gateway for hosted platforms that give every service its own hostname
# (Railway, Render). Compose deployments use docker/Caddyfile.prod with the caddy image directly.
FROM caddy:2.10.2-alpine
LABEL org.opencontainers.image.title="OpenStaff gateway" \
  org.opencontainers.image.description="Caddy gateway routing /api and /ws to the server and everything else to the web app"
COPY docker/Caddyfile.hosted /etc/caddy/Caddyfile
