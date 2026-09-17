import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@openstaff/shared'
import { bots, messages, roomMembers, rooms, roomSections, turns, users } from '../db/schema.js'
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
const createSectionSchema = z.object({ name: z.string().trim().min(1).max(80) })
const renameSectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  newName: z.string().trim().min(1).max(80),
})
const updateRoomSchema = z.object({
  name: z.string().trim().min(1).max(100).nullable().optional(),
  section: z.string().trim().max(80).nullable().optional(),
  expectedSection: z.string().max(80).nullable().optional(),
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

function normalizedSectionName(name: string): string {
  return name.trim().toLowerCase()
}

function compareSectionNames(left: string, right: string): number {
  return normalizedSectionName(left).localeCompare(normalizedSectionName(right), 'en') || left.localeCompare(right, 'en')
}

function isSqliteBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && error.code.startsWith('SQLITE_BUSY')
}

async function retrySqliteBusy<T>(operation: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isSqliteBusy(error) || attempt >= 5) throw error
    await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt))
    return retrySqliteBusy(operation, attempt + 1)
  }
}

let sectionRenameQueue: Promise<void> = Promise.resolve()

function serializeSectionRename<T>(operation: () => Promise<T>): Promise<T> {
  const result = sectionRenameQueue.then(operation)
  sectionRenameQueue = result.then(() => undefined, () => undefined)
  return result
}

async function visibleSections(db: ApiDependencies['db'], userId: string): Promise<Array<{ name: string }>> {
  const [saved, assigned] = await Promise.all([
    db.select({ name: roomSections.name }).from(roomSections).where(eq(roomSections.userId, userId)),
    db.select({ name: rooms.section }).from(roomMembers)
      .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId))),
  ])
  const candidates = [
    ...saved.map(({ name }) => ({ name: name.trim(), priority: 0 })),
    ...assigned.flatMap(({ name }) => name?.trim() ? [{ name: name.trim(), priority: 1 }] : []),
  ].sort((left, right) => left.priority - right.priority || compareSectionNames(left.name, right.name))
  const canonical = new Map<string, string>()
  for (const { name } of candidates) if (!canonical.has(normalizedSectionName(name))) canonical.set(normalizedSectionName(name), name)
  return [...canonical.values()].sort(compareSectionNames).map((name) => ({ name }))
}

async function canonicalSectionName(db: ApiDependencies['db'], userId: string, value: string | null): Promise<string | null> {
  if (value === null || !value.trim()) return null
  const trimmed = value.trim(), normalized = normalizedSectionName(trimmed)
  return (await visibleSections(db, userId)).find(({ name }) => normalizedSectionName(name) === normalized)?.name ?? trimmed
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

  app.get('/sections', async (context) => {
    return context.json({ sections: await visibleSections(db, context.get('user').id) })
  })

  app.post('/sections', async (context) => {
    const input = await parseBody(context, createSectionSchema)
    if (isResponse(input)) return input
    const userId = context.get('user').id
    const name = (await canonicalSectionName(db, userId, input.name))!
    const normalizedName = normalizedSectionName(name)
    await db.insert(roomSections).values({ userId, normalizedName, name, createdAt: new Date().toISOString() })
      .onConflictDoNothing({ target: [roomSections.userId, roomSections.normalizedName] })
    const section = (await db.select({ name: roomSections.name }).from(roomSections)
      .where(and(eq(roomSections.userId, userId), eq(roomSections.normalizedName, normalizedName))).limit(1))[0]!
    return context.json({ section }, 201)
  })

  app.patch('/sections', async (context) => {
    const input = await parseBody(context, renameSectionSchema)
    if (isResponse(input)) return input
    const userId = context.get('user').id
    const oldNormalized = normalizedSectionName(input.name), newNormalized = normalizedSectionName(input.newName)
    const outcome = await serializeSectionRename(() => retrySqliteBusy(() => db.transaction(async (transaction) => {
      const saved = await transaction.select({
        normalizedName: roomSections.normalizedName,
        name: roomSections.name,
        createdAt: roomSections.createdAt,
      }).from(roomSections).where(eq(roomSections.userId, userId))
      const assigned = await transaction.select({ room: rooms }).from(roomMembers)
        .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
        .where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId)))
      const oldSaved = saved.filter(({ name }) => normalizedSectionName(name) === oldNormalized)
      const oldAssigned = assigned.filter(({ room }) => room.section && normalizedSectionName(room.section) === oldNormalized)
      if (!oldSaved.length && !oldAssigned.length) return { kind: 'missing' as const }

      const previousName = [
        ...oldSaved.map(({ name }) => ({ name: name.trim(), priority: 0 })),
        ...oldAssigned.map(({ room }) => ({ name: room.section!.trim(), priority: 1 })),
      ].sort((left, right) => left.priority - right.priority || compareSectionNames(left.name, right.name))[0]!.name
      if (input.name === input.newName) {
        return { kind: 'renamed' as const, previousName, name: previousName, rooms: [] as Array<typeof rooms.$inferSelect> }
      }
      if (newNormalized !== oldNormalized) {
        const collides = saved.some(({ name }) => normalizedSectionName(name) === newNormalized)
          || assigned.some(({ room }) => room.section && normalizedSectionName(room.section) === newNormalized)
        if (collides) return { kind: 'collision' as const }
      }

      const savedRow = oldSaved[0]
      if (savedRow) {
        await transaction.update(roomSections).set({ normalizedName: newNormalized, name: input.newName })
          .where(and(eq(roomSections.userId, userId), eq(roomSections.normalizedName, savedRow.normalizedName)))
      } else {
        await transaction.insert(roomSections).values({
          userId,
          normalizedName: newNormalized,
          name: input.newName,
          createdAt: new Date().toISOString(),
        })
      }
      const roomIds = oldAssigned.filter(({ room }) => room.section !== input.newName).map(({ room }) => room.id)
      if (roomIds.length) await transaction.update(rooms).set({ section: input.newName }).where(inArray(rooms.id, roomIds))
      const updatedRooms = roomIds.length
        ? await transaction.select().from(rooms).where(inArray(rooms.id, roomIds))
        : []
      updatedRooms.sort((left, right) => left.id.localeCompare(right.id))
      return { kind: 'renamed' as const, previousName, name: input.newName, rooms: updatedRooms }
    })))
    if (outcome.kind === 'missing') return context.json({ error: 'Section not found' }, 404)
    if (outcome.kind === 'collision') return context.json({ error: 'Section already exists' }, 409)
    const ts = new Date().toISOString()
    for (const room of outcome.rooms) hub.broadcastRoom(room.id, { type: 'room.updated', room, ts })
    return context.json({ section: { name: outcome.name }, previousName: outcome.previousName, rooms: outcome.rooms })
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
    const section = await canonicalSectionName(db, user.id, input.section ?? null)
    const room: typeof rooms.$inferInsert = { id: createId('room'), kind: 'group', name: input.name, section, createdBy: user.id, lastMessageAt: null, lastMessagePreview: null }
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
    const userId = context.get('user').id
    if (!await member(id, userId)) return context.json({ error: 'Room not found' }, 404)
    const input = await parseBody(context, updateRoomSchema)
    if (isResponse(input)) return input
    const hasName = Object.hasOwn(input, 'name'), hasSection = Object.hasOwn(input, 'section')
    const hasExpectedSection = Object.hasOwn(input, 'expectedSection')
    const update: { name?: string | null; section?: string | null } = {}
    if (hasName) update.name = input.name
    if (hasSection) update.section = await canonicalSectionName(db, userId, input.section ?? null)
    const expected = input.expectedSection
    const condition = hasExpectedSection
      ? and(eq(rooms.id, id), expected === null ? isNull(rooms.section) : eq(rooms.section, expected!))!
      : eq(rooms.id, id)
    const room = hasName || hasSection
      ? (await db.update(rooms).set(update).where(condition).returning())[0]
      : (await db.select().from(rooms).where(condition).limit(1))[0]
    if (!room) {
      if (!await member(id, userId)) return context.json({ error: 'Room not found' }, 404)
      if (hasExpectedSection) return context.json({ error: 'Room section changed' }, 409)
      return context.json({ error: 'Room not found' }, 404)
    }
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
