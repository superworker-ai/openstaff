import type { MiddlewareHandler } from 'hono'
import type { User } from '@openstaff/shared'
import type { OpenStaffAuth } from './better-auth.js'

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
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
  }
}

export function requireAuth(auth: OpenStaffAuth): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const session = await auth.api.getSession({ headers: context.req.raw.headers })
    if (!session) return context.json({ error: 'Authentication required' }, 401)
    context.set('user', publicUser(session.user))
    await next()
  }
}
