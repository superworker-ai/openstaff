# Deploy to a cloud host

The reference production shape is one Linux VM running Docker Compose
([self-hosting](SELF_HOSTING.md)). This page covers managed hosts. Every option runs the same
images built from `docker/app.Dockerfile`; nothing in the app changes per host.

| Host | Shape | Durable SQLite | Status |
| --- | --- | --- | --- |
| Railway | 3 services (gateway, server, web) + volume | volume on `/data` | deployed and verified |
| Render | Blueprint `render.yaml`, same 3 services + disk | disk on `/data` | blueprint written, not yet exercised |
| Cloudflare | 1 Worker + 1 Container (`allinone` image) | Litestream to R2 | config written, not yet exercised |
| Fly.io, Cloud Run, any single-container host | `allinone` image | volume or Litestream | image builds, no button |

Two build arguments make the one Dockerfile fit hosts that cannot pass `--target`:

- `OPENSTAFF_TARGET` selects the final stage: `server`, `web`, or `allinone`.
- `OPENSTAFF_USER` (default `node`) lets a host with root-owned volumes run the server as `root`.

Before any deploy, generate a `SECRETS_KEY` (`openssl rand -hex 32`) and a `SIGNUP_CODE`.
Production boot refuses to start without `SECRETS_KEY`, an `https://` `PUBLIC_APP_URL`, and
one model key. Keep the key with the database: a restored database without its key cannot
decrypt saved credentials.

## Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

Railway deploy buttons point at a template. Templates are created once in the dashboard from a
running project ("Create template from project" in project settings) and give you a
`railway.com/new/template/<code>` link to put behind the button. The project below is the source.

The CLI recipe that produced the live deployment (`railway` 4.x, from a clean checkout):

```sh
railway init -n openstaff
railway add --service server \
  -v RAILWAY_DOCKERFILE_PATH=docker/app.Dockerfile -v OPENSTAFF_TARGET=server -v RAILWAY_RUN_UID=0 \
  -v NODE_ENV=production -v DATA_DIR=/data -v SERVER_PORT=8787 \
  -v SECRETS_KEY=$(openssl rand -hex 32) -v SIGNUP_CODE=$(openssl rand -hex 8) \
  -v OPENAI_API_KEY=... -v DEFAULT_MODEL=openai/gpt-5.6-sol
railway add --service web \
  -v RAILWAY_DOCKERFILE_PATH=docker/app.Dockerfile -v OPENSTAFF_TARGET=web -v NODE_ENV=production \
  -v PORT=3001 -v HOST=:: -v PUBLIC_API_URL=http://server.railway.internal:8787
railway add --service gateway \
  -v RAILWAY_DOCKERFILE_PATH=docker/gateway/Dockerfile -v PORT=3000 \
  -v SERVER_UPSTREAM=server.railway.internal:8787 -v WEB_UPSTREAM=web.railway.internal:3001
railway volume -s <server service id> add -m /data
railway domain -s gateway -p 3000            # prints https://gateway-....up.railway.app
railway variables -s server --set PUBLIC_APP_URL=https://gateway-....up.railway.app --skip-deploys
railway up -s server --ci && railway up -s web --ci && railway up -s gateway --ci
```

Notes:

- Railway's private network is IPv6. The server already binds all interfaces; the web app
  needs `HOST=::`.
- `RAILWAY_RUN_UID=0` runs the server as root because Railway volumes are root-owned.
- `railway up` uploads the working directory. Deploy from a clean export
  (`git archive HEAD | tar -x -C /tmp/deploy`) so uncommitted work never reaches production.
- The default Computer provider is `local`, which runs commands inside the server container.
  Set `COMPUTER_DRIVER=e2b` and `E2B_API_KEY` (or another remote provider) before inviting
  people you do not trust with the container.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/superworker-ai/openstaff)

`render.yaml` defines a public gateway web service, a private server with a 10 GB disk, and a
private web service. Render prompts for the `sync: false` variables (`PUBLIC_APP_URL`,
`SIGNUP_CODE`, model keys) during the blueprint flow. `PUBLIC_APP_URL` is the gateway's
`onrender.com` URL; set it after the first deploy if the URL is not known yet, then redeploy the
server. Disks require a paid plan. The server runs as root (`OPENSTAFF_USER=root`) because Render
disks are root-owned.

## Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/superworker-ai/openstaff/tree/main/deploy/cloudflare)

Cloudflare Containers run one instance of the `allinone` image behind a Worker
(`deploy/cloudflare`). Container disk is ephemeral, so durable state must live in R2:

1. Create an R2 bucket and an R2 API token with object read and write.
2. From `deploy/cloudflare`: `npm install`, then set secrets:

   ```sh
   for k in SECRETS_KEY SIGNUP_CODE PUBLIC_APP_URL XAI_API_KEY \
            S3_BUCKET S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
     npx wrangler secret put $k
   done
   ```

   `S3_ENDPOINT` is `https://<account id>.r2.cloudflarestorage.com`. `PUBLIC_APP_URL` is the
   Worker URL (`https://openstaff.<subdomain>.workers.dev`) or a custom domain.
3. `npx wrangler deploy` builds the image locally with Docker and pushes it.

On boot the entrypoint restores `openstaff.db` from the bucket when the local copy is missing,
then runs the server under `litestream replicate`. Workspace files use the same bucket through
`WORKSPACE_STORE=s3`. Without `S3_BUCKET` the container still runs, and loses everything when it
sleeps. The deploy button requires a public repository, and the Worker's build context is the
repository root, which is outside the `deploy/cloudflare` subdirectory Cloudflare clones for the
button; if the button build fails, deploy with the CLI steps above.

## All-in-one image elsewhere

`docker build --build-arg OPENSTAFF_TARGET=allinone -f docker/app.Dockerfile .` produces a
single image exposing port 3000 that runs Caddy, the server, and the web app under one
supervising entrypoint (`docker/allinone-entrypoint.sh`). Mount a volume at `/data`, or set
`S3_*` for Litestream, and it runs on Fly.io, Cloud Run, or any host that takes one container.
