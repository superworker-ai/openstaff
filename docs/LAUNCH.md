# Open-source launch and cloud readiness

Status as of 2026-09-17. This is the working checklist for taking OpenStaff public and for
the hosted ("cloud") version. Update it as items land; delete it after launch.

## Where things are

- **Repository**: `github.com/superworker-ai/openstaff` (moved from
  `juancgarza/open-superworkers` on 2026-09-17; the old URL redirects). Still **private**.
  The GHCR owner in `compose.prod.yml` and `.env.example` (`superworker-ai`) now matches
  where the release workflow publishes.
- **Branches**: `main` holds only the initial commit. The real trunk is
  `jcgarzar/open-source-grok-bot-clone`. Three feature branches are reviewed, green, and
  unmerged: `jcgarzar/cloud-phase1` (plans, suspended gate, managed model keys, usage
  export), `jcgarzar/cloud-managed-keys` (managed Composio and Computer credentials),
  `jcgarzar/auth` (Better Auth, SSO, social, 2FA, invitations, audit). They are being
  combined on `jcgarzar/integrate-cloud-auth`.
- **Hosting**: production runs on Railway (`docs/DEPLOY.md`), URL
  `gateway-production-5295.up.railway.app`, custom domain `app.myopenstaff.com` pending the
  dashboard attach and Namecheap CNAME. Marketing site is `apps/landing` for `myopenstaff.com`.
- **CI**: `checks` (typecheck, lint, tests with MinIO, build), `compose-smoke`, `security`
  (`pnpm audit --audit-level=high`, gitleaks over history and tree). Release: a `v*` tag
  builds server, web, and Computer images for amd64 and arm64, attaches SBOMs, and creates a
  GitHub release from the matching `CHANGELOG.md` section.
- **Secrets in history**: a full-history gitleaks scan on 2026-09-17 found one hit, the mock
  SAML private key in `better-auth.test.ts` (commit 705c8cf). It is a test fixture and is
  allowlisted in `.gitleaks.toml` on the auth branch. No `.env`, database, or `data/` file
  has ever been tracked.

## Before the repo goes public

Engineering

- [ ] Land `jcgarzar/integrate-cloud-auth` on the trunk (merge, CI green).
- [ ] Open a pull request from the trunk to `main` and merge it. `main` becomes the trunk;
      stop branching from `jcgarzar/open-source-grok-bot-clone`.
- [ ] Decide whether to keep the full history or squash to a single "Initial public release"
      commit. Keeping it is fine: the only flagged secret is a fixture. Squashing removes
      the fixture hit and every internal commit message, at the cost of blame history.
- [ ] Move the `Unreleased` section of `CHANGELOG.md` under a version (`0.2.0`), tag it,
      and confirm the release workflow publishes `ghcr.io/superworker-ai/openstaff-{server,web,computer}`.
- [ ] Make the three GHCR packages public (organization packages are private by default and
      must be linked to the repository and set to public in the package settings), then
      remove the `docker login ghcr.io` step from `docs/SELF_HOSTING.md` and `docs/DEPLOY.md`.
- [ ] Re-run the deploy buttons end to end (Render, Cloudflare, Railway) against the public
      repo. The Railway button still points at `railway.com/new` until a template exists.
- [ ] README: add a hero screenshot or short GIF, a "Hosted version" link to
      `app.myopenstaff.com`, and CI and license badges. Check that every relative link resolves.
- [ ] Decision D1 in `docs/CLOUD-PLAN.md` (license). Default is MIT, which `LICENSE` and
      `CONTRIBUTING.md` already state. Change it before publishing or not at all.

Repository settings (do these the moment the repo flips to public; they are unavailable on a
free private repo)

- [ ] Enable private vulnerability reporting (`SECURITY.md` promises it).
- [ ] Enable secret scanning with push protection and Dependabot alerts.
- [ ] Protect `main`: require the `checks` and `security` jobs, require pull requests, no
      force pushes.
- [ ] Turn on Discussions if support questions should not be issues.
- [ ] Upload a social preview image (`apps/landing/public/og.png`).

Already done: description, homepage, topics, delete-branch-on-merge, wiki and projects off,
`maintainers` team created and given admin on the repo so `CODEOWNERS` resolves.

Announcement

- [ ] Landing site live at `myopenstaff.com` with the GitHub link pointing at
      `superworker-ai/openstaff` (`apps/landing/src/config.ts`).
- [ ] Demo video or GIF of a room with two bots, an approval pause, and the Computer panel.
- [ ] Posts: Show HN, X, r/selfhosted, and the CopilotKit/OpenBot comparison angle from
      `.context/research/openbot-copilotkit.md`.
- [ ] Support path: `SECURITY.md` for vulnerabilities, issues for bugs, a support email for
      hosted customers.

## Day-of sequence

1. Merge the trunk into `main`, confirm CI is green on `main`.
2. Tag `v0.2.0`, wait for the release workflow, make the packages public.
3. Flip the repository to public; apply the repository settings above.
4. Pull the public images on a clean VM with `docs/SELF_HOSTING.md` and confirm `/api/ready`.
5. Publish the landing site, then post the announcements.

## Cloud version

What "cloud" means: the host owns the model keys, the sandbox, and the Composio account;
tenants get a workspace, not credentials. The code stays identical to the self-hosted
product and is steered by environment only (`WORKSPACE_PLAN`, `WORKSPACE_STATE`,
`MANAGED_KEYS`, `COMPOSIO_USER_ID`, `CONTROL_PLANE_TOKEN`). See `docs/CLOUD-PLAN.md`.

Done in code (on the branches above): plan limits and the suspended gate, managed keys for
providers, Composio, and Computer, usage export and summary, Computer session metering, and
the authentication stack a paying customer expects (SSO, 2FA, invitations, audit log).

Next, in order

1. Land the integration branch (this unblocks everything below).
2. First managed tenant on Railway: `MANAGED_KEYS=1`, `WORKSPACE_PLAN=team`,
   `COMPUTER_DRIVER=e2b`, plus `AI_GATEWAY_API_KEY` and `E2B_API_KEY` as service variables.
   Blocked on those two keys; the local `.env` only has OpenAI and Composio keys. Set spend
   budgets on both accounts before enabling anything.
3. Phase 2 control plane (`apps/cloud`). Decide first:
   - Tenant hosting. `docs/CLOUD-PLAN.md` assumes one Linux VM running one Compose project
     per tenant, which keeps self-hosters and tenants on the same bits. Railway stays the
     personal instance. Recommendation: the VM, as planned.
   - Domains. `myopenstaff.com` marketing, `app.myopenstaff.com` the existing instance,
     `cloud.myopenstaff.com` the control plane, `<slug>.myopenstaff.com` per tenant with a
     wildcard record and on-demand TLS. (Assumption; D5 in the plan is unresolved.)
   - D2 and D3 pricing shape and numbers, needed before Stripe products exist.
4. Phase 3 metering into Stripe and Phase 4 self-serve, per the plan.
