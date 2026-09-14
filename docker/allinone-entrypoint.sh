#!/bin/bash
# Supervises the three processes of the all-in-one image. Exits when any of them exits so
# the platform restarts the container. Litestream is used only when S3_BUCKET is set.
set -euo pipefail
mkdir -p /data/workspace /data/backups
cd /app

if [ -n "${S3_BUCKET:-}" ] && [ "${LITESTREAM:-1}" = "1" ]; then
  sh /opt/openstaff/litestream-entrypoint.sh restore -if-db-not-exists -if-replica-exists \
    -config /tmp/litestream.yml /data/openstaff.db
  sh /opt/openstaff/litestream-entrypoint.sh replicate -config /tmp/litestream.yml \
    -exec "node dist/index.js" &
else
  node dist/index.js &
fi
server=$!

( cd /web && HOST=127.0.0.1 PORT=3001 exec node .output/server/index.mjs ) &
web=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
gateway=$!

trap 'kill -TERM $server $web $gateway 2>/dev/null; wait' TERM INT
wait -n
status=$?
echo "a process exited with status ${status}; stopping" >&2
kill -TERM $server $web $gateway 2>/dev/null || true
wait || true
exit "${status}"
