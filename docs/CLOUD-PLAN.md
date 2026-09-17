# Cloud and billing plan

Goal: charge for OpenStaff without changing what it is. The product stays a single-tenant,
self-hostable app. Revenue comes from hosting it, holding the model and sandbox keys, and
metering what customers consume. The code itself stays free (MIT) unless we decide otherwise
in Decision D1 below.

Strategy, in order: prove willingness to pay by hand (Phase 0), add the minimum entitlement
and metering hooks to the app (Phase 1), build a small control plane that provisions one
stack per customer (Phase 2), then meter model and sandbox usage into Stripe (Phase 3) and
open self-serve signup (Phase 4).

## Decisions needed before Phase 2

- **D1. License.** MIT means anyone can host the code. We charge for hosting, compute, and
  convenience. If we ever want to sell the software itself (open core with a paid edition),
  switch new code to a source-available license before the repo goes public. Default: stay MIT.
- **D2. Pricing shape.** Default: flat monthly fee per workspace by tier, plus metered credits
  for model tokens and sandbox minutes. A bring-your-own-keys tier costs less and is not metered.
- **D3. Numbers.** Fill in when Phase 0 gives us data.

| Tier | Monthly | Included | Keys | Metered |
| --- | --- | --- | --- | --- |
| Starter | $__ | 3 bots, 3 members, 1 workspace | customer's own | no |
| Team | $__ | 10 bots, 10 members, $__ credits | ours | tokens, sandbox minutes |
| Business | $__ | unlimited bots, 25 members, $__ credits, priority support | ours | tokens, sandbox minutes |

- **D4. Cloud Computer provider.** The `local` driver runs commands as the server user and
  must never be enabled for a hosted tenant. Cloud tenants get `e2b` or `daytona` by default;
  the Docker provider only if we run one socket proxy per tenant. Default: E2B.
- **D5. Domain.** One wildcard, for example `*.openstaff.app`, one tenant per subdomain.

## Phase 0 — Concierge hosting (no code, this week)

Purpose: get the first paying customers with what already ships. Nothing here blocks on
engineering.

1. Create a Stripe product per tier and a Payment Link for each. Enable Customer Portal.
2. Rent one Linux VM (4 vCPU, 8 GB, 80 GB disk is enough for 5 to 10 tenants at first).
   Install Docker Engine with Compose v2. Point the wildcard DNS at it.
3. Per customer, after payment: create `/srv/tenants/<slug>/.env` from `.env.example` with
   `PUBLIC_HOST=<slug>.openstaff.app`, an HTTPS `PUBLIC_APP_URL`, a fresh 32-byte
   `SECRETS_KEY`, `SIGNUP_CODE`, `GHCR_OWNER=superworker-ai`, our `AI_GATEWAY_API_KEY`,
   `COMPUTER_DRIVER=e2b`, and `E2B_API_KEY`. Start with:
   `docker compose -p <slug> --env-file /srv/tenants/<slug>/.env -f docker-compose.yml -f compose.prod.yml -f compose.litestream.yml up -d`.
   Each project needs distinct host ports or a shared front Caddy; the shared Caddy is what
   Phase 2 automates, so for Phase 0 use one host port per tenant behind a hand-written Caddy.
4. Send the customer the URL and signup code. They create the owner account.
5. Nightly `pnpm run backup --upload` per tenant, or rely on the Litestream overlay to S3.
6. Track spend: the AI Gateway dashboard shows token cost, E2B shows sandbox hours. Compare
   with subscription revenue weekly. This is the data for D3.

Exit criterion: three paying tenants, or clear evidence nobody wants to pay at any price.

## Phase 1 — Entitlements and metering hooks in the app

Purpose: let a hosted tenant be limited, suspended, and measured by environment alone, so the
control plane never touches a tenant database. All of this is behind env variables and is
inert for self-hosters.

### 1.1 Plan and state from the environment

- New env: `WORKSPACE_PLAN` (`self-hosted` default, `starter`, `team`, `business`),
  `WORKSPACE_STATE` (`active` default, `past_due`, `suspended`), `MANAGED_KEYS` (`0` default).
- `apps/server/src/config.ts` parses them into `config.plan`, `config.state`, `config.managedKeys`.
- `packages/shared/src/plans.ts` exports the limits table: max bots, max members, max
  automations, allowed Computer providers, credits included. `self-hosted` is unlimited.
- Server enforces limits at the write path only: create bot, add member, create automation,
  change Computer provider. Return `402` with `{ code: 'plan_limit', limit, plan }`.
  The web app shows an upgrade card that links to `PUBLIC_BILLING_URL` (new env, optional).
- `past_due`: banner in the UI, everything works. `suspended`: `/api/ready` still returns 200,
  login works, every other API returns `402 { code: 'suspended' }`, the UI shows one page.
  The database is never modified by a state change.

### 1.2 Managed keys

- When `MANAGED_KEYS=1`, Settings hides all model-provider and Composio key fields plus
  Computer credential forms. The server ignores their saved database values and accepts
  model-provider, Composio, and Computer credentials only from the environment.
- `COMPOSIO_USER_ID` identifies the tenant inside the host's Composio account so connected
  accounts and tool execution stay isolated per workspace. It defaults to `workspace` for
  compatibility with existing connections.
- Existing key and credential resolution gains managed branches; no schema change.

### 1.3 Usage export

- New endpoint `GET /api/usage/export?since=<iso>&until=<iso>` guarded by a bearer token in
  `CONTROL_PLANE_TOKEN` (env; endpoint returns 404 when unset). Cookie auth is not accepted.
- Returns one row per turn from `turns` with `id`, `botId`, `model`, `finishedAt`, and
  `usage` as stored, plus one row per Computer session from `computer_instances` with
  provider, `startedAt`, `stoppedAt`. Both tables already exist; add an index on `finishedAt`.
- Also `GET /api/usage/summary` for the workspace owner: current-month tokens by model and
  sandbox minutes by provider. Shown in Settings under Usage.

### 1.4 Tests and docs

- Unit tests for limit enforcement and the suspended gate. Contract test for export auth.
- Document the env in `.env.example` under a "Hosted mode" heading and in
  `docs/SELF_HOSTING.md` with one line saying self-hosters can ignore it.

Codex spec for this phase: everything in 1.1 to 1.4, in that order. Do not touch billing.

## Phase 2 — Control plane

Purpose: replace the Phase 0 hands with a small service. New app `apps/cloud`, same stack
(Hono, SQLite, Drizzle), deployed on the same host as the tenants at first.

### 2.1 Data

Tables: `customers` (email, stripe customer id), `tenants` (slug, customer, plan, state,
host, ports, secrets key ref, created), `subscriptions` (stripe ids, status, period end),
`usage_snapshots` (tenant, window, tokens by model, sandbox minutes, cost, exported).

### 2.2 Billing

- Stripe Checkout for signup, Customer Portal for changes, webhooks for
  `checkout.session.completed`, `customer.subscription.updated|deleted`,
  `invoice.payment_failed|paid`. Each webhook maps to a tenant state transition and a
  re-render of the tenant `.env` followed by `docker compose up -d` (server restarts in seconds;
  SQLite is unaffected).
- State machine: `provisioning -> active -> past_due -> suspended -> deleted`, with
  `past_due -> active` on payment and a grace period of 7 days before `suspended`.

### 2.3 Provisioner

- One Compose project per tenant: `docker compose -p <slug> --env-file <path> -f ... up -d`.
  Reuses the exact files in this repo, so a self-hoster and a cloud tenant run the same bits.
- Shared front Caddy with on-demand TLS for the wildcard; the per-tenant `gateway` service is
  replaced by an internal network alias. This needs one new overlay,
  `compose.cloud.yml`, that drops the tenant gateway and joins a shared network.
- Backups: Litestream overlay per tenant, prefix `s3://<bucket>/tenants/<slug>/`.
- Lifecycle commands: create, suspend, resume, rotate secrets, delete after 30 days.
  Delete removes the volume only after a final backup is verified.

### 2.4 Operator UI

A single admin page listing tenants, state, plan, last backup, last usage snapshot, and
buttons for the lifecycle commands. Behind a Google login allowlist. Nothing customer-facing.

## Phase 3 — Metered credits

Purpose: charge for what Team and Business tenants consume beyond their included credits.

- Hourly job pulls `/api/usage/export` from every managed-keys tenant, prices tokens with a
  model price table (kept in the control plane, updated by hand), prices sandbox minutes by
  provider, and writes `usage_snapshots`.
- Push totals to Stripe Billing Meters (`token_usd`, `sandbox_minutes`). Stripe handles the
  included-credit allowance and overage on the invoice.
- Soft limit: when a tenant reaches 100% of included credits plus a configurable overage cap,
  set `WORKSPACE_STATE=past_due` style banner "credits exhausted" without suspending. Hard
  limit is a per-tenant setting, off by default.
- Show the same numbers to the customer on the Usage page from Phase 1.3 so the invoice is
  never a surprise.

## Phase 4 — Self-serve

- Landing page with the three tiers, Checkout button, and a "self-host for free" link to
  the repo once it is public.
- After Checkout: create tenant, wait for `/api/ready`, email a magic link containing the
  signup code. The owner account is created by the customer on first visit, so we never hold
  their password.
- Status page and a support email. That is the whole surface.

## Risks and guardrails

- **Never run `local` in the cloud.** Phase 1 must reject `COMPUTER_DRIVER=local` when
  `WORKSPACE_PLAN` is not `self-hosted`, at boot, with a clear error.
- **One host is a single point of failure.** Acceptable through Phase 2. Move tenants across
  hosts only when we have more than one; Litestream restore is the migration tool.
- **Private GHCR.** The host needs `docker login ghcr.io` with a read-only token until the
  repo is public. Bake it into the host setup script.
- **Key spend runaway.** Set AI Gateway and E2B budgets at the account level from day one,
  independent of the app.
- **MIT exposure.** Decided in D1. Nothing in Phases 0 to 4 depends on the answer.

## Order of work

1. Phase 0 now: Stripe products, one VM, first tenant by hand.
2. Phase 1 to Codex as one spec (this document, section "Phase 1").
3. Phase 2 after the first three tenants exist.
4. Phase 3 and 4 when metering data from Phase 2 has run for a month.
