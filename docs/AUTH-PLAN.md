# Authentication plan

Goal: authentication a security reviewer will accept. SAML and OIDC single sign-on, social
login, magic links, email verification and password reset, two-factor, invitations and roles,
session management, rate limiting, and an audit log. Self-hosters keep a zero-config path.

## Decisions

- **D1. Library.** Adopt `better-auth` (1.7.x) with `@better-auth/sso`, the Drizzle adapter on
  the existing libsql database, and the `twoFactor`, `magicLink`, and `admin` plugins. The
  Phase 1 rule "no Better Auth" was a simplicity constraint for the first foundation and is
  retired here. Hand-rolling SAML is out of the question; hosted identity vendors are out
  because self-hosters must not depend on a third party to log in.
- **D2. Tables.** Better Auth is mapped onto the existing `users` table (`modelName: 'users'`,
  `image` mapped to `avatar`, `createdAt` to `created_at`). Every foreign key in the app keeps
  pointing at `users.id`. New tables: `account`, `verification`, `two_factor`, `sso_provider`,
  `invitations`, `audit_log`. The `sessions` table is rebuilt in Better Auth's shape, which
  signs everyone out once at upgrade. Prefixed ULIDs stay: `advanced.database.generateId`
  calls `createId` from the shared package with a per-model prefix.
- **D3. Legacy passwords.** The migration copies `users.password_hash` into `account`
  (`providerId = 'credential'`) and drops the column. A custom `password.verify` recognises
  the legacy `scrypt:` encoding and verifies it; new hashes use Better Auth's default. A
  test proves a pre-migration user still logs in.
- **D4. Roles.** `owner`, `admin`, `member`. Exactly one owner. Admin is owner minus
  billing, provider keys, Computer provider, and ownership transfer. Every existing
  `role !== 'owner'` check that guards member or SSO management widens to include admin;
  the ones listed above stay owner-only.
- **D5. Sign-up policy.** `AUTH_SIGNUP` = `open` | `code` | `invite`. Default is `code` when
  `SIGNUP_CODE` is set, otherwise `open`. Hosted tenants run `invite`. The first user ever is
  always allowed (bootstrap) and becomes owner; that request still honours `SIGNUP_CODE`.
  A registered SSO domain implies sign-up for matching emails via just-in-time provisioning.
- **D6. Email.** `EMAIL_PROVIDER` = `console` | `smtp` | `resend`. `console` prints the link
  and is the default, so development and tests need nothing. `smtp` uses nodemailer with
  `SMTP_URL`; `resend` uses `RESEND_API_KEY`. `EMAIL_FROM` is required for the last two.
- **D7. Email verification.** Required when `EMAIL_PROVIDER` is not `console`. Password
  reset and magic links are available whenever email can be sent.
- **D8. SSO scope.** SAML 2.0 and OIDC per workspace, configured by owner or admin in
  Settings. Domain-based routing on the login page. `ssoOnly` workspace setting disables
  password and magic-link sign-in for emails on a registered SSO domain; the owner is exempt
  as break-glass. Hosted plans gate SSO to `business` via a new `sso` flag in `PLAN_LIMITS`;
  `self-hosted` always has it. DNS domain verification is on for hosted plans and off for
  self-hosted.
- **D9. Two-factor.** TOTP with backup codes and trusted devices. `requireTwoFactor`
  workspace setting forces enrolment for password and magic-link users; SSO and social
  users are exempt because the identity provider owns MFA.
- **D10. Secret.** `AUTH_SECRET` if set, otherwise derived from `SECRETS_KEY` with HKDF and
  the label `openstaff-auth`. Rotating `SECRETS_KEY` therefore signs everyone out.
- **D11. Out of scope for now.** SCIM provisioning, passkeys, per-user API keys, and
  organization multi-tenancy. All are Better Auth plugins that can be added later without
  schema churn.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUTH_SECRET` | Cookie and token signing | derived from `SECRETS_KEY` |
| `AUTH_SIGNUP` | `open`, `code`, `invite` | `code` if `SIGNUP_CODE` else `open` |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated extra origins | `PUBLIC_APP_URL` |
| `EMAIL_PROVIDER` | `console`, `smtp`, `resend` | `console` |
| `EMAIL_FROM` | Sender address | required unless console |
| `SMTP_URL` | `smtps://user:pass@host:465` | |
| `RESEND_API_KEY` | | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Social login | off |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Social login | off |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | Social login | off, tenant `common` |

Better Auth's `baseURL` is `PUBLIC_APP_URL` and `basePath` is `/api/auth`, so OAuth and SAML
callbacks land on the web origin and are proxied to the server like every other API call.

## Phase A — foundation

1. `apps/server/src/auth/better-auth.ts` builds the instance from `Config`: Drizzle adapter,
   model mapping, `additionalFields` for `role` (input false), generateId, session
   `expiresIn` 30 days and `updateAge` 1 day, secure cookies in production, `cookiePrefix`
   `openstaff`, trusted origins, rate limiting on in production and on every hosted plan with
   stricter rules for sign-in, magic link, and password reset, email and password with the
   legacy verifier, email verification per D7, `magicLink`, `admin` with `adminRoles`
   `['owner', 'admin']`, and `hooks.after` feeding the audit log.
2. Migration `0014_better_auth`: new tables, `users` gains `email_verified`, `updated_at`,
   `two_factor_enabled`, `banned`, `ban_reason`, `ban_expires`; `password_hash` copied into
   `account` then dropped; `sessions` rebuilt. Drizzle schema updated to match.
3. `requireAuth` and the realtime hub authenticate with `auth.api.getSession(headers)`. The
   `sw_session` cookie constant is removed from the shared package. `publicUser` adds
   `emailVerified` and `twoFactorEnabled`; the shared `userSchema` follows.
4. Hono mounts `auth.handler` at `/api/auth/*` before the suspended gate. Custom auth routes
   that remain: `GET /api/auth-config` (public: which methods are on, sign-up policy, social
   providers, whether any SSO provider exists), invitations, ownership transfer, and role
   changes that the admin plugin does not cover.
5. Sign-up policy per D5, enforced in a `hooks.before` on `/sign-up/email` and on
   `/sign-in/magic-link` when the email is unknown, plus the plan member limit from Phase 1.
6. Invitations: table, `POST /api/invitations` (owner or admin, email, role), list, revoke,
   `GET /api/invitations/:token` (public, returns email and workspace name),
   `POST /api/invitations/:token/accept` (after sign-in as that email). Invitation email via D6.
7. Email transport module with the three providers and four templates: verify email, reset
   password, magic link, invitation.
8. Audit log table and writer. Events in this phase: `auth.sign_in` (method), `auth.sign_in_failed`,
   `auth.sign_out`, `auth.sign_up`, `auth.password_reset`, `auth.email_verified`,
   `member.invited`, `member.invite_accepted`, `member.role_changed`, `member.removed`.
   `GET /api/audit?cursor` for owner and admin.
9. Web: `better-auth/react` client with the magic-link and admin client plugins. Pages:
   `/login` (password, magic link, links to sign-up when policy allows), `/signup`,
   `/verify-email`, `/forgot-password`, `/reset-password`, `/invite/$token`. Members section in
   Settings: list, invite, change role, remove. Loaders keep forwarding cookies unchanged.
10. Tests: legacy password login after migration; each sign-up policy; invitation round trip;
    magic link via the console transport; audit rows for sign-in and failed sign-in; hub
    authenticates with the new session. A shared test helper creates a signed-in user and
    returns the cookie; every existing test that inserted `sessions` rows uses it.

## Phase B — SSO, social, two-factor, admin

1. SSO: `@better-auth/sso` with `provisionUser` honouring D5 and D8, domain verification per
   D8, `sso: true` in `PLAN_LIMITS` for `self-hosted` and `business`. A Hono guard in front of
   `/api/auth/sso/register` and updates requires owner or admin and returns 402 `plan_limit`
   with `limit: 'sso'` when the plan lacks it. Settings → Security → Single sign-on: create
   and edit providers (SAML: metadata XML paste or entry point plus certificate; OIDC: issuer,
   client id and secret), show SP metadata URL, ACS URL, and entity id, toggle `ssoOnly`.
   Login page: after the email is typed, call `signIn.sso({ email })`; on 404 fall through to
   the other methods.
2. Social: Google, GitHub, Microsoft from env; buttons appear only when configured; account
   linking to an existing user with the same verified email.
3. Two-factor: TOTP enrolment with QR, backup codes, trusted device; `/security` page for the
   current user with 2FA, password change, and session list with revoke. `requireTwoFactor`
   enforcement per D9 through `requireAuth` returning 403 `two_factor_required` for
   non-auth routes and a web redirect to enrolment.
4. Admin: ban and unban, revoke a user's sessions, transfer ownership (owner only, target
   must be admin or member, old owner becomes admin). Audit log page in Settings → Security
   with pagination. New audit events: `sso.provider_created|updated|deleted`,
   `auth.two_factor_enabled|disabled`, `member.banned|unbanned`, `session.revoked`,
   `workspace.ownership_transferred`, `security.setting_changed`.
5. Tests: SAML round trip against a local mock IdP (samlify can act as one), OIDC against a
   stub issuer, SSO-only enforcement and owner exemption, plan gating, 2FA enrol and verify,
   require-2FA redirect, ownership transfer invariants.

## Risks

- Better Auth owns the `/api/auth/*` namespace; the old custom routes under it move or die.
  The suspended gate must sit after the handler so sign-in still works while suspended.
- SAML in the Docker image: `samlify` needs `@xmldom/xmldom` at runtime, no native modules.
- Cookie prefix change signs out every browser once. Release note it.
- The first hosted customers will hit domain verification; the Settings page must show the
  exact DNS record to add.
