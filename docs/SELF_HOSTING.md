# Self-hosting

The supported production path is one Linux VM with Docker Compose and one durable
volume. This is a single-tenant application: every admitted user shares the workspace,
browser session, and selected Computer.

New installations store SQLite data in `DATA_DIR/openstaff.db`. If an older installation
has only `DATA_DIR/superworkers.db`, the server renames it to `openstaff.db` on first start.

Self-hosters can ignore the hosted-mode variables. Their defaults select the unrestricted
`self-hosted` plan with an active workspace, editable provider keys, and no usage export.

1. Install Docker Engine with Compose v2 and point a DNS name at the VM.
2. Copy `.env.example` to `.env`. Set `PUBLIC_HOST`, an HTTPS `PUBLIC_APP_URL`, a
   random 32-byte `SECRETS_KEY`, and one model key. Configure E2B, Daytona, Freestyle, or Vercel Sandbox only if
   selecting that provider. Choose filesystem or S3-compatible workspace storage using
   [the storage guide](STORAGE.md).
3. Validate configuration: `pnpm run doctor` (or `pnpm --filter server run doctor`).
4. Start: `docker compose -f docker-compose.yml -f compose.prod.yml up -d`.
5. Open `https://$PUBLIC_HOST`, create the owner account, and select a Computer in Settings.

Provider choice is separate from hosting choice. Local is the default trusted-node
provider. To use Docker isolation, set distinct `COMPUTER_VIEWER_PASSWORD` and
`COMPUTER_CONTROLLER_PASSWORD` values in `.env`, then add the Docker overlay:

```sh
docker compose -f docker-compose.yml -f compose.docker.yml -f compose.prod.yml -f compose.docker.prod.yml up -d
```

The overlay uses a restricted socket proxy; do not add a raw Docker socket mount to the
base Compose file. For upgrades, back up first, set `OPENSTAFF_VERSION` to the new
release tag, pull, and repeat `up -d`. Migrations run forward only. Roll back application
code by redeploying the previous image; restore a backup separately if data recovery is
needed. See [backup and restore](BACKUP_RESTORE.md).

The base production overlay contains no Computer service. The optional Docker production
overlay changes only the image of the Computer defined by the Docker overlay, retaining
its workspace mount and resource limits.

Add `compose.litestream.yml` for continuous SQLite replication. Add `compose.hostpath.yml`
with `WORKSPACE_HOST_PATH` to put the server workspace on an Archil disk or another host mount.
This overlay starts no Computer container. For Docker, also append `compose.docker.hostpath.yml`
after `compose.docker.yml` and `compose.hostpath.yml`, with both desktop passwords configured.
The host owns the mount; do not grant FUSE capabilities
to the Computer container. All supported overlay combinations are checked in CI.

### Host-run startup

For operators running the built server directly, load the production environment, run
`pnpm db:migrate`, then `NODE_ENV=production node apps/server/dist/index.js`.
The doctor reports pending migrations as a warning; server startup applies them before
accepting requests, including on a fresh volume. Compose still runs its dedicated
`migrate` service before starting the server. Always back up before an upgrade.
