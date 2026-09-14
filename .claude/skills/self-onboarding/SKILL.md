---
name: self-onboarding
description: Onboard yourself to the OpenStaff repository before doing any work in it. Use when starting a session in this repo, when asked to "onboard", "get up to speed", "learn the codebase", or before a first change to an unfamiliar area. Reads the design docs in order, verifies the toolchain and environment, runs the health checks, and ends with a short written brief.
---

# Self-onboarding

Goal: in about ten minutes, know what OpenStaff is, how it is built, how to run and verify it,
and what the rules are, then write a brief you can act on. Do the steps in order. Do not skip
the reading because the code "looks obvious": the constraints live in the docs, not the code.

## 1. Read, in this order

1. `README.md` sections Quick start, Choose a Computer, Production, Commands.
2. `docs/ARCHITECTURE.md` sections 1, 2, 4, 5, 6, 9, 10 and 13. This is the design of record;
   when code and this doc disagree, say so.
3. `docs/PLAN.md` to see which phases are done and what is open.
4. `CONTRIBUTING.md` for the checklist every change must pass.
5. Only if the task touches them: `docs/COMPUTER_PROVIDERS.md`, `docs/STORAGE.md`,
   `docs/SELF_HOSTING.md`, `docs/DEPLOY.md`, `docs/BACKUP_RESTORE.md`, `docs/CLOUD-PLAN.md`.

While reading, note these facts; they come up in almost every task:

- Monorepo: `apps/server` (Hono, SQLite via Drizzle, WebSocket hub, agent runtime),
  `apps/web` (TanStack Start), `packages/shared` (zod schemas, wire protocol).
- Single-tenant: every admitted user shares one workspace, one browser session, one Computer.
- Credentials and model messages never reach the browser. Tool activity belongs in the
  Computer panel, not in message bubbles.
- Model ids are always `provider/model`.
- Migrations are forward-only. Back up before an upgrade.
- The `local` Computer driver runs commands as the server user; never enable it for a hosted
  tenant with untrusted users.

## 2. Verify the toolchain

```sh
node --version        # 22.x
corepack enable && pnpm --version   # matches packageManager in package.json
docker --version      # optional, needed for Docker Computer and image builds
git status --short    # know what is already modified before you touch anything
```

If `git status` shows changes you did not make, another session may be working in this tree.
Leave those files alone and stage only your own paths when you commit.

## 3. Configure and check the environment

```sh
test -f .env || cp .env.example .env
pnpm install
pnpm run doctor
```

`doctor` names every configuration item with a status. In development, missing keys are
warnings; in production they are fatal. At least one model key is required to chat. Read the
doctor output rather than guessing what is configured.

## 4. Run the checks

```sh
pnpm typecheck
pnpm lint
pnpm test          # SKIP_BROWSER_TESTS=1 if Chromium is unavailable
```

Run them before your first change to know the baseline. A failure that predates you is
useful context, not something to fix silently.

## 5. Map the area you will change

For the task at hand, find the entry points and their tests:

- HTTP routes: `apps/server/src/api/*.ts`, mounted in `apps/server/src/app.ts`.
- Agent loop and tools: `apps/server/src/agent/`, Computer drivers in
  `apps/server/src/computer/`.
- Realtime events: `packages/shared/src/wire.ts` and `apps/server/src/realtime/`.
- UI: `apps/web/src/routes/` and `apps/web/src/components/`.
- Deployment: `docker/app.Dockerfile`, the compose overlays at the root, `render.yaml`,
  `deploy/cloudflare/`, and `.github/workflows/`.

Read the nearest existing test before writing a new one; match its harness.

## 6. Write the brief

Finish with a short brief in this shape, in your own words:

- What the product is and what the current phase is working toward.
- The exact commands that passed or failed on this machine, with the failing names.
- What is configured (model provider, Computer driver, storage) according to `doctor`.
- The files you expect to touch for the task and the tests that cover them.
- Any doc-versus-code mismatch or pre-existing failure you noticed.

Then start the task. Re-read the relevant `docs/ARCHITECTURE.md` section before changing
behaviour in it.
