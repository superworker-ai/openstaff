import type { MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import type { User } from '@openstaff/shared'
import type { OpenStaffAuth } from './better-auth.js'
import type { Database } from '../db/index.js'
import { account } from '../db/schema.js'
import { readWorkspaceAuthSettings } from './workspace-security.js'

export interface AppVariables {
  user: User
}

interface PublicUserSource {
  id: string
  email: string
  name: string
  image?: string | null
  avatar?: string | null
  role?: string | null
  emailVerified?: boolean
  twoFactorEnabled?: boolean
  banned?: boolean
  banReason?: string | null
  banExpires?: string | Date | null
  createdAt: string | Date
}

function role(value: string | null | undefined): User['role'] {
  return value === 'owner' || value === 'admin' ? value : 'member'
}

export function publicUser(row: PublicUserSource): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.image ?? row.avatar ?? null,
    role: role(row.role),
    emailVerified: row.emailVerified ?? false,
    twoFactorEnabled: row.twoFactorEnabled ?? false,
    banned: row.banned ?? false,
    banReason: row.banReason ?? null,
    banExpires: row.banExpires ? (typeof row.banExpires === 'string' ? row.banExpires : row.banExpires.toISOString()) : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
  }
}

export async function needsTwoFactorEnrollment(db: Database, user: User): Promise<boolean> {
  if (user.twoFactorEnabled || !(await readWorkspaceAuthSettings(db)).requireTwoFactor) return false
  const accounts = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, user.id))
  return accounts.every((row) => row.providerId === 'credential')
}

export function requireAuth(auth: OpenStaffAuth, db: Database): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const session = await auth.api.getSession({ headers: context.req.raw.headers })
    if (!session) return context.json({ error: 'Authentication required' }, 401)
    const user = publicUser(session.user)
    context.set('user', user)
    const securityGet = context.req.path === '/api/security' && context.req.method === 'GET'
    if (!securityGet && await needsTwoFactorEnrollment(db, user)) return context.json({ error: 'Two-factor authentication enrolment is required', code: 'two_factor_required' }, 403)
    await next()
  }
}
