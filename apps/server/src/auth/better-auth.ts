import { hkdfSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { APIError, betterAuth } from 'better-auth'
import type { MiddlewareHandler } from 'hono'
import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { verifyPassword } from 'better-auth/crypto'
import { admin } from 'better-auth/plugins/admin'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'
import { magicLink } from 'better-auth/plugins/magic-link'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { sso } from '@better-auth/sso'
import { and, count, eq, gt, isNull } from 'drizzle-orm'
import { createId, PLAN_LIMITS, type IdKind } from '@openstaff/shared'
import type { AuditWriter } from '../audit.js'
import { requestIp } from '../audit.js'
import type { Config } from '../config.js'
import type { Database } from '../db/index.js'
import * as databaseSchema from '../db/schema.js'
import { invitations, ssoProvider, users } from '../db/schema.js'
import type { SendEmail } from '../email/index.js'
import { magicLinkTemplate, resetPasswordTemplate, verifyEmailTemplate } from '../email/templates.js'
import { verifyLegacyPassword } from './password.js'
import { checkMemberPlan, PlanLimitError } from '../plan.js'
import { readWorkspaceAuthSettings } from './workspace-security.js'

const modelIds: Record<string, IdKind> = {
  user: 'user', users: 'user', session: 'session', sessions: 'session', account: 'account',
  verification: 'verification', twoFactor: 'twoFactor', ssoProvider: 'ssoProvider',
}

function secretKey(config: Config): Buffer {
  if (process.env.SECRETS_KEY) {
    const value = process.env.SECRETS_KEY
    return Buffer.from(value, /^[0-9a-f]{64}$/i.test(value) ? 'hex' : 'base64')
  }
  return Buffer.from(readFileSync(path.join(config.dataDir, 'secrets.key'), 'utf8').trim(), 'hex')
}

export function deriveAuthSecret(config: Config): string {
  if (config.authSecret) return config.authSecret
  return Buffer.from(hkdfSync('sha256', secretKey(config), Buffer.alloc(0), 'openstaff-auth', 32)).toString('base64url')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function textField(value: unknown, key: string): string | undefined {
  const field = record(value)?.[key]
  return typeof field === 'string' ? field : undefined
}

function authUserId(context: { context: { newSession: { user: { id: string } } | null; session: { user: { id: string } } | null; returned?: unknown } }): string | undefined {
  const returnedUser = record(record(context.context.returned)?.user)
  return context.context.newSession?.user.id ?? context.context.session?.user.id ?? (typeof returnedUser?.id === 'string' ? returnedUser.id : undefined)
}

function statusCode(value: unknown): number {
  return isAPIError(value) ? value.statusCode : value instanceof Response ? value.status : 200
}

const emailDomain = (email: string) => email.split('@')[1]?.toLowerCase()
const domainMatches = (email: string, domains: string) => domains.split(',').some((domain) => {
  const value = emailDomain(email), expected = domain.trim().toLowerCase().replace(/^@/, '')
  return Boolean(value && expected && (value === expected || value.endsWith(`.${expected}`)))
})

export function createAuth(config: Config, db: Database, dependencies: { sendEmail: SendEmail; audit: AuditWriter }) {
  const { sendEmail, audit } = dependencies
  const requireVerification = config.email.provider !== 'console'
  const configuredSocialProviders = Object.keys(config.social) as Array<keyof Config['social']>

  const hasSsoDomain = async (email: string) => (await db.select({ domain: ssoProvider.domain }).from(ssoProvider)).some((row) => domainMatches(email, row.domain))
  const enforceSignup = async (value: unknown, headers: Headers | undefined, options: { afterCreate?: boolean; skipCode?: boolean } = {}) => {
    const email = textField(value, 'email')?.trim().toLowerCase()
    if (!email) return
    const rawTotal = (await db.select({ value: count() }).from(users))[0]?.value ?? 0
    const total = Math.max(0, rawTotal - (options.afterCreate ? 1 : 0))
    const suppliedCode = headers?.get('x-signup-code') ?? textField(value, 'signupCode')
    const admittedBySsoDomain = total > 0 && await hasSsoDomain(email)
    if (!admittedBySsoDomain && !options.skipCode && config.signupCode && (total === 0 || config.authSignup === 'code') && suppliedCode !== config.signupCode) {
      throw new APIError('FORBIDDEN', { code: 'invalid_signup_code', message: 'Invalid signup code' })
    }
    if (!admittedBySsoDomain && total > 0 && config.authSignup === 'code' && !config.signupCode) throw new APIError('FORBIDDEN', { code: 'signup_closed', message: 'Sign-up is closed' })
    if (!admittedBySsoDomain && total > 0 && config.authSignup === 'invite') {
      const pending = (await db.select({ id: invitations.id }).from(invitations).where(and(
        eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date().toISOString()),
      )).limit(1))[0]
      if (!pending) throw new APIError('FORBIDDEN', { code: 'invitation_required', message: 'A pending invitation is required' })
    }
    if (!options.afterCreate) {
      const limit = await checkMemberPlan(db, config)
      if (limit) throw new APIError('PAYMENT_REQUIRED', { ...limit.body(), message: limit.message })
    }
  }

  const plugins = [
    magicLink({
      storeToken: 'hashed',
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: async ({ email, url }) => sendEmail({ to: email, ...magicLinkTemplate(url) }),
    }),
    sso({
      provisionUser: async ({ user, provider }) => {
        if (!domainMatches(user.email, provider.domain)) throw new APIError('FORBIDDEN', { code: 'sso_domain_mismatch', message: 'The identity email does not match the SSO provider domain' })
        await enforceSignup(user, undefined, { afterCreate: true })
      },
      domainVerification: { enabled: config.plan !== 'self-hosted' },
      saml: { enableInResponseToValidation: true, allowIdpInitiated: false },
      organizationProvisioning: { disabled: true },
    }),
    twoFactor({ issuer: 'OpenStaff', allowPasswordless: true, backupCodeOptions: { storeBackupCodes: 'encrypted' }, trustDeviceMaxAge: 60 * 60 * 24 * 30 }),
    // Only the owner may use Better Auth's admin endpoints; workspace admins use /api/members, which cannot touch the owner.
    admin({ defaultRole: 'member', adminRoles: ['owner'], roles: { owner: adminAc, admin: userAc, member: userAc } }),
  ]

  return betterAuth({
    appName: 'OpenStaff',
    ...(config.publicAppUrl ? { baseURL: config.publicAppUrl } : {}),
    basePath: '/api/auth',
    secret: deriveAuthSecret(config),
    database: drizzleAdapter(db, { provider: 'sqlite', schema: databaseSchema }),
    user: {
      modelName: 'users',
      fields: { image: 'avatar', createdAt: 'createdAt', updatedAt: 'updatedAt', emailVerified: 'emailVerified' },
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'member', input: false },
        twoFactorEnabled: { type: 'boolean', required: true, defaultValue: false, input: false },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
      cookiePrefix: 'openstaff',
      database: { generateId: ({ model }) => createId(modelIds[model] ?? 'verification') },
    },
    trustedOrigins: config.trustedOrigins,
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production' || config.plan !== 'self-hosted',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 200,
      requireEmailVerification: requireVerification,
      password: { verify: async ({ hash, password }) => hash.startsWith('scrypt:') ? verifyLegacyPassword(password, hash) : verifyPassword({ hash, password }) },
      sendResetPassword: async ({ user, url }) => sendEmail({ to: user.email, ...resetPasswordTemplate(url) }),
    },
    emailVerification: {
      sendOnSignUp: requireVerification,
      sendVerificationEmail: async ({ user, url }) => sendEmail({ to: user.email, ...verifyEmailTemplate(url) }),
    },
    socialProviders: config.social,
    account: { accountLinking: { enabled: true, trustedProviders: configuredSocialProviders } },
    databaseHooks: {
      user: { create: { before: async (user, context) => {
        await enforceSignup(user, context?.headers, { skipCode: context?.path === '/sign-up/email' })
        const total = (await db.select({ value: count() }).from(users))[0]?.value ?? 0
        return { data: { ...user, role: total === 0 ? 'owner' : 'member' } }
      } } },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === '/sign-up/email') await enforceSignup(context.body, context.headers)
        if (context.path === '/sign-in/magic-link') {
          const email = textField(context.body, 'email')?.trim().toLowerCase()
          if (email && !(await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]) await enforceSignup(context.body, context.headers)
        }
        if (['/sign-in/email', '/sign-in/magic-link', '/request-password-reset'].includes(context.path)) {
          const email = textField(context.body, 'email')?.trim().toLowerCase()
          if (!email) return
          const providers = await db.select({ domain: ssoProvider.domain }).from(ssoProvider)
          if (!providers.some((row) => domainMatches(email, row.domain)) || !(await readWorkspaceAuthSettings(db)).ssoOnly) return
          const target = (await db.select({ role: users.role }).from(users).where(eq(users.email, email)).limit(1))[0]
          if (target?.role !== 'owner') throw new APIError('FORBIDDEN', { code: 'sso_required', message: 'Your organisation requires single sign-on' })
        }
      }),
      after: createAuthMiddleware(async (context) => {
        const returned: unknown = context.context.returned
        const failed = statusCode(returned) >= 400
        const actorUserId = authUserId(context)
        const email = textField(context.body, 'email')?.trim().toLowerCase()
        const common = { actorIp: requestIp(context.headers), actorUserId: actorUserId ?? null }
        if (context.path === '/sign-in/email') {
          const event = failed ? 'auth.sign_in_failed' : 'auth.sign_in'
          await audit({ ...common, event, targetType: 'user', targetId: actorUserId ?? email ?? 'unknown', metadata: { method: 'email-password' } })
        } else if (context.path === '/magic-link/verify' && !failed) {
          await audit({ ...common, event: 'auth.sign_in', targetType: 'user', targetId: actorUserId ?? 'unknown', metadata: { method: 'magic-link' } })
        } else if (context.path === '/sign-out' && !failed) {
          await audit({ ...common, event: 'auth.sign_out', targetType: 'user', targetId: actorUserId ?? 'unknown' })
        } else if (context.path === '/sign-up/email' && !failed) {
          await audit({ ...common, event: 'auth.sign_up', targetType: 'user', targetId: actorUserId ?? email ?? 'unknown', metadata: { method: 'email-password' } })
        } else if (context.path === '/reset-password' && !failed) {
          await audit({ ...common, event: 'auth.password_reset', targetType: 'auth', targetId: 'password' })
        } else if (context.path === '/verify-email' && !failed) {
          await audit({ ...common, event: 'auth.email_verified', targetType: 'user', targetId: actorUserId ?? 'unknown' })
        } else if (context.path === '/two-factor/verify-totp' && !failed && context.context.session?.user) {
          await audit({ ...common, event: 'auth.two_factor_enabled', targetType: 'user', targetId: actorUserId ?? 'unknown' })
        } else if (context.path === '/two-factor/disable' && !failed) {
          await audit({ ...common, event: 'auth.two_factor_disabled', targetType: 'user', targetId: actorUserId ?? 'unknown' })
        } else if (context.path === '/sso/register' && !failed) {
          await audit({ ...common, event: 'sso.provider_created', targetType: 'sso_provider', targetId: textField(context.body, 'providerId') ?? 'unknown' })
        } else if (context.path === '/sso/update-provider' && !failed) {
          await audit({ ...common, event: 'sso.provider_updated', targetType: 'sso_provider', targetId: textField(context.body, 'providerId') ?? 'unknown' })
        } else if (context.path === '/sso/delete-provider' && !failed) {
          await audit({ ...common, event: 'sso.provider_deleted', targetType: 'sso_provider', targetId: textField(context.body, 'providerId') ?? 'unknown' })
        } else if ((context.path.startsWith('/sso/callback') || context.path.startsWith('/sso/saml2/sp/acs/')) && !failed && actorUserId) {
          await audit({ ...common, event: 'auth.sign_in', targetType: 'user', targetId: actorUserId, metadata: { method: 'sso' } })
        } else if (context.path.startsWith('/callback/') && !failed && actorUserId) {
          const provider = context.path.slice('/callback/'.length)
          if (configuredSocialProviders.includes(provider as keyof Config['social'])) await audit({ ...common, event: 'auth.sign_in', targetType: 'user', targetId: actorUserId, metadata: { method: `social:${provider}` } })
        }
      }),
    },
    plugins,
  })
}

export type OpenStaffAuth = ReturnType<typeof createAuth>

// Admin endpoints that bypass the sign-up policy, plan limits, the single-owner rule, or grant impersonation.
export const disabledAuthPaths: ReadonlySet<string> = new Set(['create-user', 'set-role', 'update-user', 'set-user-password', 'impersonate-user', 'stop-impersonating'].map((name) => `/api/auth/admin/${name}`))

export function authHandler(auth: OpenStaffAuth) {
  return (context: { req: { path: string; raw: Request }; json: (body: { error: string }, status: 404) => Response }) =>
    disabledAuthPaths.has(context.req.path) ? context.json({ error: 'Not found' }, 404) : auth.handler(context.req.raw)
}

export function ssoMutationGuard(auth: OpenStaffAuth, config: Pick<Config, 'plan'>): MiddlewareHandler {
  return async (context, next) => {
    const session = await auth.api.getSession({ headers: context.req.raw.headers })
    if (!session) return context.json({ error: 'Authentication required' }, 401)
    const role = typeof session.user.role === 'string' ? session.user.role : 'member'
    if (role !== 'owner' && role !== 'admin') return context.json({ error: 'Workspace administrator required' }, 403)
    if (!PLAN_LIMITS[config.plan].sso) return context.json(new PlanLimitError('sso', config.plan, false).body(), 402)
    await next()
  }
}
