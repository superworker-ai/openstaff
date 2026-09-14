import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@openstaff/shared'
import { roomMembers, tasks } from '../db/schema.js'
import type { AppEnv, ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

const statusSchema = z.enum(['open', 'in_progress', 'done', 'cancelled'])

export function taskRoutes({ db, admission, hub }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/', async (context) => {
    const roomId = context.req.query('roomId')
    const userId = context.get('user').id
    if (roomId && !await admission.isMember(roomId, 'user', userId)) return context.json({ error: 'Room not found' }, 404)
    const rows = roomId
      ? await db.select().from(tasks).where(eq(tasks.roomId, roomId)).orderBy(tasks.updatedAt)
      : (await db.select({ task: tasks }).from(tasks).innerJoin(roomMembers, eq(roomMembers.roomId, tasks.roomId)).where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId)))).map((row) => row.task)
    return context.json({ tasks: rows })
  })
  app.post('/', async (context) => {
    const input = await parseBody(context, z.object({ roomId: z.string(), title: z.string().min(1).max(200), brief: z.string(), ownerBotId: z.string(), status: statusSchema.default('open') }))
    if (isResponse(input)) return input
    const user = context.get('user')
    if (!await admission.isMember(input.roomId, 'user', user.id) || !await admission.isMember(input.roomId, 'bot', input.ownerBotId)) return context.json({ error: 'Room or bot not found' }, 404)
    const now = new Date().toISOString()
    const task = { id: createId('task'), ...input, createdByKind: 'user' as const, createdById: user.id, handoffFromBotId: null, createdAt: now, updatedAt: now }
    await db.insert(tasks).values(task)
    hub.broadcastRoom(input.roomId, { type: 'task.updated', task, ts: now })
    return context.json({ task }, 201)
  })
  app.patch('/:id', async (context) => {
    const input = await parseBody(context, z.object({ title: z.string().min(1).max(200).optional(), brief: z.string().optional(), ownerBotId: z.string().optional(), status: statusSchema.optional() }))
    if (isResponse(input)) return input
    const existing = (await db.select().from(tasks).where(eq(tasks.id, context.req.param('id'))).limit(1))[0]
    if (!existing || !await admission.isMember(existing.roomId, 'user', context.get('user').id)) return context.json({ error: 'Task not found' }, 404)
    if (input.ownerBotId && !await admission.isMember(existing.roomId, 'bot', input.ownerBotId)) return context.json({ error: 'Bot not found' }, 404)
    const task = (await db.update(tasks).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(tasks.id, existing.id)).returning())[0]!
    hub.broadcastRoom(task.roomId, { type: 'task.updated', task, ts: new Date().toISOString() })
    return context.json({ task })
  })
  app.delete('/:id', async (context) => {
    const existing = (await db.select().from(tasks).where(eq(tasks.id, context.req.param('id'))).limit(1))[0]
    if (!existing || !await admission.isMember(existing.roomId, 'user', context.get('user').id)) return context.json({ error: 'Task not found' }, 404)
    await db.delete(tasks).where(eq(tasks.id, existing.id))
    return context.json({ ok: true })
  })
  return app
}
