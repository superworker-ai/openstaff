import { and, desc, eq, lt, or } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../auth/session.js'
import { auditLog } from '../db/schema.js'
import type { ApiDependencies } from './context.js'

export function auditRoutes({ db }: Pick<ApiDependencies, 'db'>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.get('/', async (context) => {
    if (!['owner', 'admin'].includes(context.get('user').role)) return context.json({ error: 'Workspace administrator required' }, 403)
    const requested = Number(context.req.query('limit') ?? 50)
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 50
    const cursorId = context.req.query('cursor')
    const cursor = cursorId ? (await db.select({ id: auditLog.id, at: auditLog.at }).from(auditLog).where(eq(auditLog.id, cursorId)).limit(1))[0] : undefined
    if (cursorId && !cursor) return context.json({ error: 'Invalid audit cursor' }, 400)
    const rows = await db.select().from(auditLog).where(cursor ? or(lt(auditLog.at, cursor.at), and(eq(auditLog.at, cursor.at), lt(auditLog.id, cursor.id))) : undefined).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit)
    return context.json({ events: rows, nextCursor: rows.length === limit ? rows.at(-1)!.id : null })
  })
  return app
}
