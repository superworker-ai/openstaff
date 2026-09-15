import { hkdfSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { APIError, betterAuth } from 'better-auth'
import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { verifyPassword } from 'better-auth/crypto'
import { admin } from 'better-auth/plugins/admin'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'
import { magicLink } from 'better-auth/plugins/magic-link'
import { and, count, eq, gt, isNull } from 'drizzle-orm'
import { createId, type IdKind } from '@openstaff/shared'
import type { AuditWriter } from '../audit.js'
import { requestIp } from '../audit.js'
import type { Config } from '../config.js'
import type { Database } from '../db/index.js'
import * as databaseSchema from '../db/schema.js'
import { invitations, users } from '../db/schema.js'
import type { SendEmail } from '../email/index.js'
import { magicLinkTemplate, resetPasswordTemplate, verifyEmailTemplate } from '../email/templates.js'
import { verifyLegacyPassword } from './password.js'
import { checkMemberPlan } from '../plan.js'

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
  return isAPIError(value) ? value.statusCode : 200
}

export function createAuth(config: Config, db: Database, dependencies: { sendEmail: SendEmail; audit: AuditWriter }) {
  const { sendEmail, audit } = dependencies
  const requireVerification = config.email.provider !== 'console'
  const plugins = [
    magicLink({
      storeToken: 'hashed',
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: async ({ email, url }) => sendEmail({ to: email, ...magicLinkTemplate(url) }),
    }),
    admin({ defaultRole: 'member', adminRoles: ['owner', 'admin'], roles: { owner: adminAc, admin: adminAc, member: userAc } }),
  ]

  const enforceSignup = async (value: unknown, headers: Headers | undefined) => {
    const email = textField(value, 'email')?.trim().toLowerCase()
    if (!email) return
    const total = (await db.select({ value: count() }).from(users))[0]?.value ?? 0
    const suppliedCode = headers?.get('x-signup-code') ?? textField(value, 'signupCode')
    if (config.signupCode && (total === 0 || config.authSignup === 'code') && suppliedCode !== config.signupCode) {
      throw new APIError('FORBIDDEN', { code: 'invalid_signup_code', message: 'Invalid signup code' })
    }
    if (total === 0) return
    if (config.authSignup === 'code' && !config.signupCode) throw new APIError('FORBIDDEN', { code: 'signup_closed', message: 'Sign-up is closed' })
    if (config.authSignup === 'invite') {
      const pending = (await db.select({ id: invitations.id }).from(invitations).where(and(
        eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date().toISOString()),
      )).limit(1))[0]
      if (!pending) throw new APIError('FORBIDDEN', { code: 'invitation_required', message: 'A pending invitation is required' })
    }
    const limit = await checkMemberPlan(db, config)
    if (limit) throw new APIError('PAYMENT_REQUIRED', { ...limit.body(), message: limit.message })
  }

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
    databaseHooks: {
      user: { create: { before: async (user) => {
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
        }
      }),
    },
    plugins,
  })
}

export type OpenStaffAuth = ReturnType<typeof createAuth>
