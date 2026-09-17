# OpenStaff

OpenStaff is an open-source foundation for an always-on staff of AI teammates. Humans and named bots share iMessage-style rooms, bots get separately scheduled turns, and consequential tools can pause for approval without losing the conversation.

## Quick start

Requirements: Node 22.22.3 or newer in the Node 22 line, and Corepack. The Composio SDK
declares this minimum patch version.

```bash
pnpm i
cp .env.example .env
```

Set one model key (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, or `AI_GATEWAY_API_KEY`) in `.env`, then run:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The web app proxies API and WebSocket traffic to the server on port 8787.

If no provider key is configured, the app still boots and persists turns. A direct bot turn fails gracefully with a system message explaining which provider key is missing.

The default computer driver is local. It can execute commands with the server user's
permissions: use Docker for command isolation. The shell's path jail protects file tools,
not arbitrary shell programs. Do not expose this single-workspace development app to
untrusted users.

## Landing page

The static OpenStaff marketing site lives in `apps/landing`.
Run it locally with `pnpm dev:landing`.
`pnpm --filter landing build` outputs the production site to `apps/landing/dist`.

## Browser setup

From the repository root, install Chromium into the mutable data directory:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/data/playwright"
pnpm --filter server exec playwright install chromium
pnpm dev
```

Keep that environment variable set when running the server or save its absolute value
in `.env`. Linux may also require Playwright's `install --with-deps chromium` command.
If Chromium cannot launch, browser tools return an actionable error and the turn continues.

Each turn owns a page in one persistent browser context. Approval pauses retain the page
until the turn resumes; completed/cancelled turns close it. Snapshots provide ARIA refs for
click/type, and browser clicks and typing require approval under `writes`. With Local, E2B,
Daytona, Freestyle, or Vercel Sandbox, the browser stays in the server process and its profile lives at
`DATA_DIR/browser-profile`. Docker uses the headed browser in its desktop container over CDP.
Screenshots for every provider remain in `DATA_DIR/screens`.

On the Docker provider, bots can also see and operate the full shared desktop with native-resolution
screenshots, pixel clicks and drags, typing, key chords, scrolling, and window switching. These
computer tools share the browser's human-takeover lease and display mutex. Bots prefer structured
browser snapshots when available because they are cheaper and more reliable, using desktop vision
for native apps, canvases, dialogs, and browser fallbacks.

## Choose a Computer

Every bot shares one always-on Computer. Settings → Computer selects Local, Docker, E2B,
Daytona, Freestyle, or Vercel Sandbox, shows its capabilities, and stores vendor credentials encrypted at the workspace
scope. `COMPUTER_DRIVER` is an operator override that locks Settings. Local uses the server
filesystem and is appropriate only for trusted deployments; Docker and remote providers isolate
commands from the server host. See [Computer providers](docs/COMPUTER_PROVIDERS.md).

E2B is also a full Computer: a hosted Firecracker microVM with a persistent 1280×800 desktop,
live takeover stream, native computer-use input, and a headed Chromium controlled over CDP.
Set `E2B_DESKTOP_TEMPLATE` to choose a desktop template, or set `E2B_DESKTOP=0` for the legacy
shell-only mode. E2B keeps filesystem and memory indefinitely while paused; Hobby permits 1 hour
and Pro 24 hours of continuous runtime before a pause and resume resets the clock. Default desktop
compute is approximately $0.17 per running hour. Returning or expiring takeover rotates the whole
stream, so viewer sessions reconnect as well as the old controller URL becoming invalid.

The Docker Computer persists both `/workspace` in `superworkers-data` and `/home/worker` in
`superworkers-home`. Home contains the Chromium profile, cookies, logins, dotfiles, shell
history, and user-level tools. Container restarts and image upgrades preserve both volumes;
system packages, the writable root filesystem, and running processes do not persist. Put
idempotent user-level installation scripts in `/home/worker/setup.d`. Reset home state with
`docker volume rm superworkers-home` only after stopping the stack and confirming that saved
browser sessions and home files may be deleted.

The desktop needs at least 2 vCPU, 4 GiB memory, and 1 GiB shared memory. At every start the
container probes whether Chromium's own sandbox works under the supplied seccomp profile with all
capabilities dropped. When it does, Chromium runs sandboxed; when it does not (Docker Desktop on
arm64 fails the zygote's `sys_chroot` check, for example) Chromium starts with `--no-sandbox` and
logs a warning, so the stack still boots. The container boundary (non-root, `cap_drop: ALL`,
seccomp, `no-new-privileges`) applies either way. Set `COMPUTER_CHROME_NO_SANDBOX=0` to require
the sandbox and fail loudly instead, or `1` to skip the probe and always disable it.

## Production

The canonical self-host path is a single Linux VM with Docker Compose, a durable volume, and
Caddy HTTPS. Run `pnpm run doctor` after configuring `.env`, back up before upgrades, and use the
explicit Docker overlay only when selecting Docker as the Computer provider. See
[self-hosting](docs/SELF_HOSTING.md), [backup and restore](docs/BACKUP_RESTORE.md), and
[releases](docs/RELEASES.md).

### Deploy to a cloud host

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/superworker-ai/openstaff)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/superworker-ai/openstaff/tree/main/deploy/cloudflare)

Railway runs the gateway, server, and web as three services with a volume. Render uses the
`render.yaml` blueprint with a disk. Cloudflare runs the all-in-one image in a Container with
SQLite replicated to R2. The same Dockerfile serves every host through the `OPENSTAFF_TARGET`
build argument. See [deploy](docs/DEPLOY.md) for each recipe and its caveats.

## Docker quick start

Docker Engine/Desktop with a recent Compose v2 supporting volume subpaths is required.

```sh
cp .env.example .env
# Set a provider key in .env
docker compose up --build
```

Open http://localhost:3000. Compose builds production web/server bundles, serves the web
through a same-origin Caddy gateway, and exposes the server on 8787. Data persists in
the named `superworkers-data` volume. Stopping Compose does not delete the data volume.

To use the Docker Computer, set `COMPUTER_VIEWER_PASSWORD` and
`COMPUTER_CONTROLLER_PASSWORD` in `.env`, then add the Docker overlay:

```sh
docker compose -f docker-compose.yml -f compose.docker.yml up --build
```

The computer joins the private Compose network without publishing ports, runs desktop
processes as uid 1000, mounts the workspace and home volumes, and enforces the documented
memory, process, capability, and seccomp limits. A restricted socket proxy lets the server
manage the container; treat server access as host-administrator access.

For a host-run server using the Docker driver, build the computer image first:

```sh
pnpm computer:build
COMPUTER_DRIVER=docker pnpm dev
```

The development server does not build the image. In this host-run mode, the driver publishes
the desktop's CDP and VNC ports on ephemeral `127.0.0.1` ports only. Compose keeps both ports
private on its network.

On native Linux, ensure `DATA_DIR/workspace` is writable by uid 1000. A container named
`superworkers-computer` belonging to another workspace is rejected, never replaced.
`COMPUTER_IMAGE` selects another compatible image. Settings → Computer changes the
saved driver and restarts the computer; `COMPUTER_DRIVER` overrides the saved setting.

## Workspace

The pnpm workspace contains:

- `packages/shared`: Zod entity schemas, prefixed ULID helpers, constants, and the realtime protocol.
- `apps/server`: Hono, WebSocket hub, SQLite with Drizzle migrations, authentication, scheduling, the AI SDK agent runtime, approvals, tasks, and the local computer driver.
- `apps/web`: TanStack Start, React 19, Tailwind 4, React Query, and the three-pane chat interface.

All mutable runtime data lives beneath `DATA_DIR`, including `openstaff.db` and the shared `workspace` directory. Older installs that still have `superworkers.db` get it renamed to `openstaff.db` on the next server start.

Bot memory, saved skills, and room uploads can instead use AWS S3, Cloudflare R2, MinIO,
or another S3-compatible store. Local/Docker can share the filesystem directly, E2B attaches
a native volume when available, and every remote provider has a synchronization fallback.
See [workspace storage, Archil, and one-bucket recovery](docs/STORAGE.md).

## Commands

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm db:migrate
pnpm run doctor
pnpm db:backup
pnpm db:backup --upload
pnpm db:restore <backup.db>
pnpm db:restore s3://backups/<backup.db>
```

The catalog includes direct xAI, Anthropic, and OpenAI models, plus OpenCode Zen models under `opencode/<model>` and OpenCode Go models under `opencode-go/<model>`. One `OPENCODE_API_KEY` serves both OpenCode prefixes. Zen is pay per token; Go quotas belong to the OpenCode account. Reasoning effort is not configurable for OpenCode models. Model identifiers always use the `provider/model` form. When an AI Gateway key is saved in Settings or supplied through `AI_GATEWAY_API_KEY`, non-OpenCode model calls go through the AI Gateway; OpenCode Zen and Go always connect directly.

## Plugins and connected apps

Open **Marketplace → Apps** for integrations or **Skills** for plugins without app servers. Settings
lists installed plugins, their enabled state, skills, unsupported hooks, and variable
inputs generated from their manifest. Installation and variable changes are managed
by the workspace owner.

The install API accepts `marketplace:<name>`, `git:https://host/repo.git#subdir`, or
`path:/absolute/plugin/directory` in `{ "source": "..." }` at `POST /api/plugins/install`.
Local sources are copied into `DATA_DIR/plugins`; the source is not modified.
`PLUGIN_MARKETPLACE_URL` changes the index. For custom indexes outside GitHub's raw
content host, set `PLUGIN_MARKETPLACE_REPO` to the corresponding Git clone URL.

Enabled plugin skills are loaded on demand. Always-applied rules enter the prompt,
agents appear as delegation hints, and MCP tools are namespaced by plugin. HTTP, SSE,
and stdio MCP transports are supported. Plugin hooks are displayed as unsupported and
are never run. The local computer and plugin processes are development tools, not OS sandboxes.

Stdio MCP clients are pooled per plugin/server, reused while healthy, and closed on
registry changes or shutdown. HTTP/SSE clients remain per-turn. A failed MCP connection
is skipped; a later turn can reconnect without replaying an uncertain tool write.

All bots share app connections under the workspace identity. The Apps catalog combines
Composio toolkits and Cursor app plugins in one card per app. Skills install immediately.

### Marketplace browsing

Apps and Skills load 24 cards at a time, with infinite scroll and a keyboard-accessible
**Load more** button. Search is debounced for 250 ms and runs on the server. The count
shows how many matching cards are loaded. Apps rank name matches before aliases and
descriptions, then Connected, Expired, installed plugins, and Available.

With a Composio key, the server builds the catalog in the background at startup and
on key changes, refreshing every 15 minutes. Cold requests fetch just one Composio
page (including server-side search), never the whole catalog. While either catalog
is warming, the UI shows “Loading the full catalog…” and checks every 3 seconds.
Cold counts are provisional; pagination starts once the merged snapshot is ready.
Plugin index hydration also runs in the background and retains its 5-minute cache.
Connect and Install patch existing cards in place, preserving loaded pages and scroll.

## Connecting apps

The workspace owner connects apps from **Marketplace → Apps**. Each app shows its
connection status and the available methods:

- **Composio one-click:** choose **Connect with Composio**. If no key is configured,
  follow the inline link to get one, paste it, and continue. Sign-in opens in a small
  popup; your chat stays open. Settings → Providers can also manage the key.
- **Plugins with dynamic client registration (DCR):** choose **Install plugin**. The
  Connect dialog opens immediately; click **Connect** and complete the consent screen.
- **Google-style manual clients:** the dialog guides you through creating a Web
  application OAuth client in the provider console, enabling the app's API, and adding
  the exact displayed redirect URI. Paste the client ID and secret, then connect.
  Clients are stored once per issuer, so Gmail, Drive, and Calendar reuse the same Google
  client. Each app still needs its own consent grant. In testing, add your Google account
  as a consent-screen test user.

The callback uses `PUBLIC_APP_URL` (default `http://localhost:3000`) plus
`/api/plugins/oauth/callback`. Register that exact URI; use the public web origin in
production. The dialog explains declined consent, wrong client credentials, and redirect
URI mismatches. Completion updates the dialog immediately, with a two-second status
check as a fallback. Successful popups close themselves; without an opener, the callback
shows “Connected, you can close this tab”.

When a bot needs an app that is not connected, the conversation pauses with
**<Bot> needs <App> connected**. **Connect <App>** opens sign-in. A verified callback
automatically resumes the pending tool with fresh credentials. **Not now** denies the
request and lets the bot explain; closing the popup leaves the request pending for up to
24 hours. Bots see connection status in their prompt and can use `request_connection`
before attempting an app action. Only connected app tools reach the model. Connected
tools retain their normal approval policy. If an app rejects expired credentials during
an action, a Reconnect card pauses the turn and the bot is instructed to retry after sign-in.

Type **`/connect <app>`** in the composer to create a connection card without a model
call. Autocomplete shows app names and their status. Click a not-connected app chip in
a bot message, or an app in the Members panel, for the same flow. New teammates suggest
their template's apps in a welcome message. The first-run checklist links model setup,
app connection, and teammate creation.

**Settings → Connections** lists Composio accounts, plugin OAuth servers, and shared
OAuth clients. Use **Reconnect**, **Disconnect**, or **Forget client** there. Disconnect
removes plugin tokens locally or deletes the Composio connected account. OAuth client
secrets, tokens, and PKCE verifiers are encrypted with the workspace secrets key.
Every 30 minutes, a background check refreshes MCP tokens expiring within one hour.
Failed refreshes appear as **Expired**, with the last check time and error in Settings.
Live status dots in Members are green (connected), yellow (expired), or grey (not connected).

## Settings and secrets

Settings contains Providers, Models, Plugins, Connections, and Automations. The model
catalog includes Grok 4.6/4.5, Claude Sonnet 5/Opus 5, GPT 5.6 Sol/Luna, and OpenCode Zen and Go models.
Saved provider keys take precedence over environment variables; clearing a saved key
restores the environment fallback. Keys and plugin variables are encrypted at rest
with AES-256-GCM and are never returned to the browser.

Set `SECRETS_KEY` to 32 random bytes encoded as 64 hex characters or base64. Otherwise
the server creates `DATA_DIR/secrets.key` with restricted permissions and logs a warning.
**Back up this file with the database**; encrypted values cannot be recovered without it.

Shell commands receive only PATH, HOME set to the workspace, LANG, TERM=dumb, and any
explicit `COMPUTER_ENV_*` variables. Plugin `${VAR}` substitution reads plugin variables
and explicit `PLUGIN_ENV_*` values. Ordinary server keys are not inherited by shell or
MCP processes. Under `writes`, MCP tools need approval unless readOnlyHint is true.
Composio uses a documented slug-token heuristic for read operations; use `all` for
mandatory approval on every operation.

## Automations

Create schedule or webhook automations inside a room's settings, or ask a bot to schedule
recurring work. A schedule uses cron plus an IANA timezone. A webhook returns its plaintext key
once; send payloads with:

```sh
curl -X POST http://localhost:3000/api/hooks/automations/<id> -H 'Authorization: Bearer <key>' -H 'Content-Type: application/json' -d '{"idempotencyKey":"evt-1","text":"hello"}'
```

Each firing snapshots up to five target bots and records one run per bot. The `skip` overlap
policy drops only targets already busy in the room; `queue` admits work behind current turns.
Schedule timestamps and webhook idempotency keys deduplicate deliveries. One missed schedule can
optionally catch up after restart. Three consecutive failed or partially failed invocations pause
the automation and post a room notice; resuming clears the failure count.

Settings can run, pause, resume, edit, delete, inspect history, cancel active runs, and regenerate
webhook keys. Manual runs remain available while an automation is paused.
The reproducible Phase 2 smoke script is `scripts/smoke-phase2.ts`; run it with the
server workspace's `tsx` executable. It installs the supplied reference plugins,
waits up to 65 seconds for a real minute-based cron tick, and cleans up its temporary data.

## Conversation and Computer panel

Free-text bot mentions never schedule teammates: delegation goes through `handoff`.
Optional replies reject acknowledgements and repetition. Stop cancels a running turn.
Files up to 20 MB can be uploaded with the composer attachment button; bots receive
the jailed workspace path. The Computer panel shows screenshots, compact tool activity,
and open tasks. Token totals appear in member tooltips and Settings → Bots.

When the Docker desktop is available, any workspace member can choose **Take over** to receive
interactive control while browser tools pause. A 30-second heartbeat keeps the control lease
alive for up to the configured timeout. **Return control** reconnects the desktop as read-only,
captures a fresh bot observation, and resumes blocked browser work; workspace owners can force a
stale takeover to return. Browser approval cards also offer **Take over** and **Done by me** for
password, 2FA, CAPTCHA, and payment steps that the bot must not repeat.

Long rooms are summarized incrementally after completed turns, outside the reply path,
at most once per 20 new messages. Original messages are retained. The summary model is
the configured reply-decision model, falling back to the workspace default.

## Testing

`pnpm test` always runs real headless Chromium tests for signup/login redirects,
bot and group creation, chat, tool approval, and Marketplace hydration. UI flows use
real forms and deterministic mock models, with temporary DATA_DIRs and ephemeral
API/Vite ports; they do not use your workspace data or running dev servers.
Install Chromium first with `pnpm --filter server exec playwright install chromium`
(CI also installs the system dependencies). To deliberately opt out of browser
coverage, run `SKIP_BROWSER_TESTS=1 pnpm test`.

## Verification

`pnpm test` includes real local Chromium tool and Marketplace hydration tests. Only
Docker tests are skipped by default; enable them with `DOCKER_TESTS=1`. Set
`SKIP_BROWSER_TESTS=1` only when deliberately omitting browser coverage.

```sh
pnpm --filter server exec tsx ../../scripts/smoke-phase3.ts
```

This smoke boots a real local-driver server with a mock model, navigates to a local page,
captures screenshots, verifies authenticated screenshot serving, and stops both servers.
It retains its temporary DATA_DIR under `data/phase3-smoke-*` for inspecting the proof.

## Architecture, screenshots, and license

See [Architecture](docs/ARCHITECTURE.md), [Plan](docs/PLAN.md), and
[Contributing](CONTRIBUTING.md). Screenshot gallery: reserved for future product captures;
the reproducible browser smoke supplies a real Computer screenshot in the meantime.

MIT, see [LICENSE](LICENSE). Cursor schemas and fixture excerpts retain their upstream
MIT notices alongside the copied files.
