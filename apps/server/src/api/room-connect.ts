import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { appSlug, connectionPath, createId } from '@openstaff/shared'
import { approvals, bots, roomMembers, turns } from '../db/schema.js'
import { AgentConnections } from '../agent/connections.js'
import { publicTurn } from '../db/public.js'
import type { ApiDependencies, AppEnv } from './context.js'
import { isResponse, parseBody } from './helpers.js'
import { resumeConnections } from './connection-resume.js'

export function roomConnectionRoutes(dependencies: ApiDependencies) {
  const { db, admission, registry, composio, hub, config } = dependencies, app = new Hono<AppEnv>()
  app.post('/:id/connect', async (c) => {
    const roomId = c.req.param('id'), user = c.get('user')
    if (!await admission.isMember(roomId, 'user', user.id)) return c.json({ error: 'Room not found' }, 404)
    const input = await parseBody(c, z.object({ app: z.string().trim().min(1).max(120) }))
    if (isResponse(input)) return input
    const service = new AgentConnections(registry, composio), connection = await service.find(input.app)
    if (!connection) return c.json({ error: 'App not found. Find it in Apps first.' }, 404)
    const existing = (await db.select().from(approvals).where(and(eq(approvals.roomId, roomId), eq(approvals.kind, 'connect'), eq(approvals.status, 'pending')))).find((item) => item.connection && appSlug(item.connection.appName) === appSlug(connection.appName))
    const path = (connection: Parameters<typeof connectionPath>[0], id: string) => connection.source === 'composio' && !composio.configured() ? `/connect/composio?approval=${id}&toolkit=${encodeURIComponent(connection.toolkit!)}` : connectionPath(connection, id)
    if (existing?.connection) return c.json({ approval: existing, connectUrl: path(existing.connection, existing.id) })
    const bot = (await db.select({ bot: bots }).from(roomMembers).innerJoin(bots, eq(bots.id, roomMembers.memberId)).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberKind, 'bot'))).orderBy(asc(roomMembers.joinedAt)).limit(1))[0]?.bot
    if (!bot) return c.json({ error: 'Add a teammate to connect an app in this room' }, 409)
    const trigger = await admission.post({ roomId, authorKind: 'user', authorId: user.id, text: `/connect ${connection.appName}`, planReplies: false })
    const id = createId('approval'), turnId = createId('turn'), now = new Date().toISOString()
    const turn = { id: turnId, roomId, botId: bot.id, triggerMessageId: trigger.message.id, replyMode: 'direct' as const, status: 'waiting_approval' as const, model: bot.model ?? config.defaultModel, modelMessages: [], handoffDepth: 0 }
    const approval = { id, turnId, roomId, botId: bot.id, approvalId: id, toolName: 'request_connection', input: { app: connection.appName }, summary: `${bot.name} needs ${connection.appName} connected`, kind: 'connect' as const, resumeMode: 'connection' as const, connection: { ...connection, connectUrl: connectionPath(connection, id) }, status: 'pending' as const, createdAt: now, decidedAt: null, decidedBy: null }
    await db.batch([db.insert(turns).values(turn), db.insert(approvals).values(approval)])
    await admission.post({ roomId, authorKind: 'system', authorId: null, text: approval.summary, attachments: [{ subtype: 'approval', approvalId: id, botName: bot.name, kind: 'connect', appName: connection.appName }], planReplies: false })
    hub.broadcastRoom(roomId, { type: 'approval.updated', approval, ts: now })
    hub.broadcastRoom(roomId, { type: 'turn.updated', turn: publicTurn({ ...turn, usage: null, error: null, startedAt: null, finishedAt: null }), ts: now })
    if (await service.connected(connection)) {
      await resumeConnections(dependencies, connection, user.id, id)
      return c.json({ approval: { ...approval, status: 'approved' }, connectUrl: `/api/connections/complete?approval=${id}` }, 201)
    }
    return c.json({ approval, connectUrl: path(connection, id) }, 201)
  })
  return app
}
