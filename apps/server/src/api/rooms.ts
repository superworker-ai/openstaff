import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@openstaff/shared'
import { bots, messages, roomMembers, rooms, turns, users } from '../db/schema.js'
import { fileAttachmentSchema, validateAttachments } from './uploads.js'
import { publicTurn } from '../db/public.js'
import type { AppEnv, ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(100),
  botIds: z.array(z.string()).min(2).max(6),
  userIds: z.array(z.string()).default([]),
  section: z.string().trim().max(80).nullable().optional(),
})
const memberSchema = z.object({ kind: z.enum(['user', 'bot']), id: z.string() })
const postMessageSchema = z.object({
  text: z.string().trim().max(100_000),
  attachments: z.array(fileAttachmentSchema).max(10).default([]),
  clientRequestId: z.string().min(1).max(120),
  mentions: z.array(z.object({ kind: z.enum(['user', 'bot']), id: z.string() })).optional(),
})

async function details(db: ApiDependencies['db'], room: typeof rooms.$inferSelect) {
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, room.id)).orderBy(asc(roomMembers.joinedAt))
  const botIds = members.filter((member) => member.memberKind === 'bot').map((member) => member.memberId)
  const userIds = members.filter((member) => member.memberKind === 'user').map((member) => member.memberId)
  const botRows = botIds.length ? await db.select().from(bots).where(inArray(bots.id, botIds)) : []
  const userRows = userIds.length ? await db.select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar, role: users.role, createdAt: users.createdAt }).from(users).where(inArray(users.id, userIds)) : []
  return { ...room, members: members.map((member) => ({ ...member, entity: member.memberKind === 'bot' ? botRows.find((bot) => bot.id === member.memberId) : userRows.find((user) => user.id === member.memberId) })) }
}

export function roomRoutes({ db, admission, hub, computer, durable }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function member(roomId: string, userId: string): Promise<boolean> {
    return admission.isMember(roomId, 'user', userId)
  }

  app.get('/', async (context) => {
    const user = context.get('user')
    const rows = await db.select({ room: rooms }).from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId)).where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, user.id))).orderBy(rooms.section, desc(rooms.lastMessageAt))
    return context.json({ rooms: await Promise.all(rows.map(({ room }) => details(db, room))) })
  })

  app.post('/', async (context) => {
    const input = await parseBody(context, createRoomSchema)
    if (isResponse(input)) return input
    const botIds = [...new Set(input.botIds)]
    if (botIds.length < 2 || botIds.length > 6) return context.json({ error: 'Groups need 2 to 6 distinct bots' }, 400)
    if ((await db.select({ id: bots.id }).from(bots).where(inArray(bots.id, botIds))).length !== botIds.length) return context.json({ error: 'One or more bots do not exist' }, 400)
    const user = context.get('user')
    const userIds = [...new Set([user.id, ...input.userIds])]
    if ((await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds))).length !== userIds.length) return context.json({ error: 'One or more users do not exist' }, 400)
    const now = new Date().toISOString()
    const room: typeof rooms.$inferInsert = { id: createId('room'), kind: 'group', name: input.name, section: input.section ?? null, createdBy: user.id, lastMessageAt: null, lastMessagePreview: null }
    await db.transaction(async (transaction) => {
      await transaction.insert(rooms).values(room)
      await transaction.insert(roomMembers).values([
        ...botIds.map((memberId) => ({ roomId: room.id, memberKind: 'bot' as const, memberId, joinedAt: now })),
        ...userIds.map((memberId) => ({ roomId: room.id, memberKind: 'user' as const, memberId, joinedAt: now })),
      ])
    })
    return context.json({ room: await details(db, room as typeof rooms.$inferSelect) }, 201)
  })

  app.get('/:id', async (context) => {
    const id = context.req.param('id')
    if (!await member(id, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    const room = (await db.select().from(rooms).where(eq(rooms.id, id)).limit(1))[0]
    return room ? context.json({ room: await details(db, room) }) : context.json({ error: 'Room not found' }, 404)
  })

  app.patch('/:id', async (context) => {
    const id = context.req.param('id')
    if (!await member(id, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    const input = await parseBody(context, z.object({ name: z.string().trim().min(1).max(100).nullable().optional(), section: z.string().trim().max(80).nullable().optional() }))
    if (isResponse(input)) return input
    const room = (await db.update(rooms).set(input).where(eq(rooms.id, id)).returning())[0]
    if (!room) return context.json({ error: 'Room not found' }, 404)
    hub.broadcastRoom(id, { type: 'room.updated', room, ts: new Date().toISOString() })
    return context.json({ room })
  })

  app.post('/:id/members', async (context) => {
    const roomId = context.req.param('id')
    if (!await member(roomId, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    const input = await parseBody(context, memberSchema)
    if (isResponse(input)) return input
    const exists = input.kind === 'bot' ? (await db.select().from(bots).where(eq(bots.id, input.id)).limit(1))[0] : (await db.select().from(users).where(eq(users.id, input.id)).limit(1))[0]
    if (!exists) return context.json({ error: 'Member not found' }, 404)
    await db.insert(roomMembers).values({ roomId, memberKind: input.kind, memberId: input.id, joinedAt: new Date().toISOString() }).onConflictDoNothing()
    return context.json({ ok: true }, 201)
  })

  app.delete('/:id/members/:kind/:memberId', async (context) => {
    const roomId = context.req.param('id')
    const kind = context.req.param('kind')
    const memberId = context.req.param('memberId')
    if (!await member(roomId, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    if (kind !== 'user' && kind !== 'bot') return context.json({ error: 'Invalid member kind' }, 400)
    const room = (await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1))[0]
    if (room?.kind === 'dm' && kind === 'bot') return context.json({ error: 'A dm must keep its bot' }, 409)
    if (kind === 'bot') {
      const botMembers = await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberKind, 'bot')))
      if (botMembers.length <= 2) return context.json({ error: 'A group must keep at least two bots' }, 409)
    }
    await db.delete(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberKind, kind), eq(roomMembers.memberId, memberId)))
    return context.json({ ok: true })
  })

  app.get('/:id/messages', async (context) => {
    const roomId = context.req.param('id')
    if (!await member(roomId, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    const after = Math.max(0, Number(context.req.query('after') ?? 0))
    const limit = Math.min(200, Math.max(1, Number(context.req.query('limit') ?? 100)))
    const initial = context.req.query('after') === undefined
    const rows = await db.select().from(messages).where(and(eq(messages.roomId, roomId), gt(messages.seq, after))).orderBy(initial ? desc(messages.seq) : asc(messages.seq)).limit(limit)
    return context.json({ messages: initial ? rows.reverse() : rows })
  })

  app.post('/:id/messages', async (context) => {
    const roomId = context.req.param('id')
    const user = context.get('user')
    if (!await member(roomId, user.id)) return context.json({ error: 'Room not found' }, 404)
    const input = await parseBody(context, postMessageSchema)
    if (isResponse(input)) return input
    if (!input.text && !input.attachments.length) return context.json({ error: 'Message is empty' }, 400)
    try { await validateAttachments(computer, roomId, input.attachments, durable) } catch { return context.json({ error: 'Invalid attachment' }, 400) }
    const result = await admission.post({ attachments: input.attachments, roomId, authorKind: 'user', authorId: user.id, text: input.text, clientRequestId: input.clientRequestId, explicitMentions: input.mentions })
    return context.json(result, result.deduplicated ? 200 : 201)
  })

  app.get('/:id/turns', async (context) => {
    const roomId = context.req.param('id')
    if (!await member(roomId, context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    const rows = await db.select().from(turns).where(eq(turns.roomId, roomId)).orderBy(asc(turns.startedAt))
    return context.json({ turns: rows.map(publicTurn) })
  })
  return app
}
