import { and, eq, gt } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createId, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, type User } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { sessions, users } from '../db/schema.js'

export interface AppVariables {
  user: User
}

export function publicUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
    createdAt: row.createdAt,
  }
}

export async function createSession(context: Context, db: Database, userId: string): Promise<void> {
  const id = createId('session')
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  await db.insert(sessions).values({ id, userId, expiresAt })
  setCookie(context, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  })
}

export async function destroySession(context: Context, db: Database): Promise<void> {
  const id = getCookie(context, SESSION_COOKIE)
  if (id) await db.delete(sessions).where(eq(sessions.id, id))
  deleteCookie(context, SESSION_COOKIE, { path: '/' })
}

export function requireAuth(db: Database): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const sessionId = getCookie(context, SESSION_COOKIE)
    if (!sessionId) return context.json({ error: 'Authentication required' }, 401)
    const rows = await db.select({ user: users }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date().toISOString())))
      .limit(1)
    const row = rows[0]
    if (!row) return context.json({ error: 'Authentication required' }, 401)
    context.set('user', publicUser(row.user))
    await next()
  }
}
