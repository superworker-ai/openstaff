import { and, asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { approvals, roomMembers, turnEvents, turns } from '../db/schema.js'
import { appendApprovalResponse } from '../agent/runtime.js'
import type { AppEnv, ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'
import { z } from 'zod'
import { AgentConnections } from '../agent/connections.js'
import { publicTurn } from '../db/public.js'
import { approvalDecisionSchema } from '@openstaff/shared'

export function turnRoutes({ db, scheduler }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  async function allowed(turnId: string, userId: string) {
    return (await db.select({ turn: turns }).from(turns).innerJoin(roomMembers, eq(roomMembers.roomId, turns.roomId)).where(and(eq(turns.id, turnId), eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId))).limit(1))[0]?.turn
  }
  app.get('/:id/events', async (context) => {
    const id = context.req.param('id')
    if (!await allowed(id, context.get('user').id)) return context.json({ error: 'Turn not found' }, 404)
    return context.json({ events: await db.select().from(turnEvents).where(eq(turnEvents.turnId, id)).orderBy(asc(turnEvents.seq)) })
  })
  app.post('/:id/cancel', async (context) => {
    const id = context.req.param('id')
    if (!await allowed(id, context.get('user').id)) return context.json({ error: 'Turn not found' }, 404)
    return await scheduler.cancel(id) ? context.json({ ok: true }) : context.json({ error: 'Turn cannot be cancelled' }, 409)
  })
  return app
}

export function approvalRoutes({ db, scheduler, hub, admission, registry, composio }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/', async (context) => {
    const roomId = context.req.query('roomId')
    if (!roomId) return context.json({ error: 'roomId is required' }, 400)
    const user = context.get('user')
    const isMember = (await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, user.id))).limit(1))[0]
    if (!isMember) return context.json({ error: 'Room not found' }, 404)
    return context.json({ approvals: await db.select().from(approvals).where(eq(approvals.roomId, roomId)).orderBy(asc(approvals.createdAt), sql`${approvals}.rowid`) })
  })
  app.post('/:id', async (context) => {
    const id = context.req.param('id')
    const input = await parseBody(context, z.object({ decision: approvalDecisionSchema, reason: z.string().max(500).optional() }))
    if (isResponse(input)) return input
    const user = context.get('user')
    const approval = (await db.select().from(approvals).innerJoin(roomMembers, eq(roomMembers.roomId, approvals.roomId)).where(and(eq(approvals.id, id), eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, user.id))).limit(1))[0]?.approvals
    if (!approval) return context.json({ error: 'Approval not found' }, 404)
    if (input.decision === 'approve' && approval.kind === 'connect' && (!approval.connection || !await new AgentConnections(registry, composio).connected(approval.connection))) return context.json({ error: 'Connect the app before continuing' }, 409)
    const decision = input.decision === 'approve' ? true : input.decision === 'human_completed' ? 'human_completed' as const : false
    const turn = await appendApprovalResponse(db, id, decision, input.reason, { decidedBy: user.id, hub, admission })
    if (!turn) return context.json({ error: 'Approval is no longer pending' }, 409)
    const updated = (await db.select().from(approvals).where(eq(approvals.id, id)))[0]!
    hub.broadcastRoom(approval.roomId, { type: 'approval.updated', approval: updated, ts: new Date().toISOString() })
    hub.broadcastRoom(approval.roomId, { type: 'turn.updated', turn: publicTurn(turn), ts: new Date().toISOString() })
    if (turn.status === 'queued') scheduler.enqueue([turn])
    return context.json({ approval: updated })
  })
  return app
}
