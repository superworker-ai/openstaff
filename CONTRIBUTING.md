# Contributing

Use Node 22.22.3 or newer in the Node 22 line and pnpm via Corepack. Read
[ARCHITECTURE](docs/ARCHITECTURE.md) and [PLAN](docs/PLAN.md) before changing behavior.
New here? Follow [ONBOARDING](docs/ONBOARDING.md); coding agents should read it before their
first change, too.

Install dependencies, configure `.env`, and install Chromium as described in the README.
Keep changes focused, TypeScript strict, and files small. Add a regression test for fixes.
Never expose credentials or model messages to the browser; tool activity belongs only in
the Computer panel, not message bubbles. Preserve upstream notices in plugin fixtures.

Before submitting:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
docker compose config
```

Browser tests run real Chromium against local pages. `SKIP_BROWSER_TESTS=1` skips them
when Chromium is unavailable. Docker tests are opt-in with `DOCKER_TESTS=1` and require
the local computer image to be built. They use a uniquely named disposable container.
Do not use production credentials or user data in tests.

Describe the behavior change, tests run, and any limitations in your pull request.
Contributions are licensed under MIT.

## Migrations

Never edit a migration file that may already have been applied (anything committed, or anything a running dev server has picked up). Drizzle applies migrations by journal timestamp and will not re-run a changed file, so the live database silently drifts from the schema. Add a new numbered file plus a `_journal.json` entry instead.
