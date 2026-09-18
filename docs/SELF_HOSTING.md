# Self-hosting

The supported production path is one Linux VM with Docker Compose and one durable
volume. Managed hosts (Railway, Render, Cloudflare) are covered in [deploy](DEPLOY.md). This is a single-tenant application: every admitted user shares the workspace,
browser session, and selected Computer.

New installations store SQLite data in `DATA_DIR/openstaff.db`. If an older installation
has only `DATA_DIR/superworkers.db`, the server renames it to `openstaff.db` on first start.

Self-hosters can ignore the hosted-mode variables. Their defaults select the unrestricted
`self-hosted` plan with an active workspace, editable provider keys and Computer credentials,
and no usage export.

Authentication is closed by default: `AUTH_SIGNUP` is `invite` unless `SIGNUP_CODE` is set,
in which case it is `code`. The `console` email provider prints verification, password-reset,
magic-link, and invitation URLs to stdout. Production email can use `smtp` with `SMTP_URL` or
`resend` with `RESEND_API_KEY`; both require `EMAIL_FROM`. Set `AUTH_TRUSTED_ORIGINS` when
browsers use origins beyond `PUBLIC_APP_URL`.

The branded templates are React Email components in `apps/server/src/email/templates`; preview them
with `pnpm email:dev`. Keep `EMAIL_FROM` on the same domain as `PUBLIC_APP_URL` for deliverability.

### Members and invitations

`AUTH_SIGNUP` has three modes. `invite` (the default) admits only emails holding a live
invitation. `code` admits anyone who supplies `SIGNUP_CODE`. `open` admits anyone who reaches
the sign-up page. An invitation always wins: an invited email may register in any mode without
the code, and arrives with the role it was invited as.

While the users table is empty the login page offers "Create the first account for this
workspace" whatever the policy says, and that first account becomes the `owner`. If
`SIGNUP_CODE` is set, the first account must still supply it.

Owners and administrators invite from Settings → Members. Creating an invitation always shows
the link, with a Copy link button; when `EMAIL_PROVIDER=console` the panel says so and the
link is the only delivery. With `smtp` or `resend` the same link is emailed. Links live seven
days. Expired invitations stay in the list, labelled, and Resend rotates the token, clears any
revocation, and restarts the seven days — the previous link stops working. Revoke retires an
invitation for good. Invitations are consumed wherever the account is created, so a password,
magic-link, social, or SSO sign-up with the invited email all settle the invitation.

Roles are `owner`, `admin`, and `member`. There is exactly one owner, who alone manages
billing, provider keys, the Computer provider, and ownership transfer. Administrators manage
members, invitations, and SSO. Removing a member passes their bots, rooms, automations, tasks,
and Computer credentials to the owner and deletes their account; nobody can ban, revoke the
sessions of, or remove their own account.

### Single sign-on

The owner or a workspace administrator can add a SAML or OpenID Connect provider in
Settings → Security. For SAML, copy the displayed SP metadata URL, ACS URL, and entity ID
into the identity provider. Then paste the IdP metadata XML back into OpenStaff, or enter
the IdP sign-in endpoint and signing certificate separately. OpenID Connect needs the
issuer, client ID, client secret, and, when discovery is not at the standard issuer URL,
the discovery URL. Multiple email domains can be entered as a comma-separated list.

Self-hosted installations do not require DNS domain verification. Hosted installations
show the exact TXT record in Settings; sign-in remains unavailable until it verifies.
Set `PUBLIC_APP_URL` to the externally reachable HTTPS origin before exchanging metadata,
because it determines every callback URL.

### Two-factor

Users manage authenticator-based two-factor authentication from Your security. Setup
returns an authenticator URI and one-time backup codes; save those codes before leaving
the page. Trusted devices last 30 days. Owners can require enrolment for password and
magic-link accounts in Settings → Security. Social and SSO accounts are exempt because
their identity provider is responsible for multi-factor authentication.

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
