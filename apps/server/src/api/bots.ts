import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { appName, avatarSchema, createId, suggestedApps } from '@openstaff/shared'
import { bots, roomMembers, rooms } from '../db/schema.js'
import type { ApiDependencies, AppEnv } from './context.js'
import { isResponse, parseBody } from './helpers.js'
import { checkBotPlan } from '../plan.js'

export const botTemplates = [
  { id: 'research', name: 'Research', job: 'Research partner', instructions: 'Find reliable information, compare sources, and surface concise insights.', avatar: { shape: 'drop', color: '#2E90FA', eyes: 'round', mouth: 'smile', accessory: 'glasses', personality: 'curious' } },
  { id: 'growth', name: 'Head of Growth', job: 'Growth strategist', instructions: 'Design practical growth experiments, positioning, and distribution plans.', avatar: { shape: 'blob', color: '#EE46BC', eyes: 'happy', mouth: 'grin', accessory: 'none', personality: 'gremlin' } },
  { id: 'engineer', name: 'Engineer', job: 'Software engineer', instructions: 'Build and debug reliable software. Prefer small, verified changes.', avatar: { shape: 'hex', color: '#F04438', eyes: 'dot', mouth: 'flat', accessory: 'headphones', personality: 'calm' } },
  { id: 'ops', name: 'Ops', job: 'Operations lead', instructions: 'Turn ambiguity into clear processes, owners, and next actions.', avatar: { shape: 'triangle', color: '#F79009', eyes: 'dot', mouth: 'smile', accessory: 'cap', personality: 'playful' } },
  { id: 'custom', name: 'Custom', job: '', instructions: '', avatar: { shape: 'circle', color: '#98A2B3', eyes: 'dot', mouth: 'smile', accessory: 'none', personality: 'playful' } },
].map((template) => ({ ...template, suggestedApps: suggestedApps[template.id] ?? [] }))

const createBotSchema = z.object({
  templateId: z.enum(['research', 'growth', 'engineer', 'ops', 'custom']).optional(),
  name: z.string().trim().min(1).max(80),
  job: z.string().trim().min(1).max(160),
  instructions: z.string().max(20_000).default(''),
  avatar: avatarSchema,
  model: z.string().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  approvalPolicy: z.enum(['auto', 'writes', 'all']).default('writes'),
})

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'bot'
}

export function botRoutes({ db, hub, admission, computer, durable, config }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/templates', (context) => context.json({ templates: botTemplates }))
  app.get('/', async (context) => context.json({ bots: await db.select().from(bots).orderBy(bots.createdAt) }))

  app.post('/', async (context) => {
    const input = await parseBody(context, createBotSchema)
    if (isResponse(input)) return input
    const limit = await checkBotPlan(db, config)
    if (limit) return context.json(limit.body(), 402)
    const user = context.get('user')
    const base = slugify(input.name)
    let slug = base
    let suffix = 2
    while ((await db.select({ id: bots.id }).from(bots).where(eq(bots.slug, slug)).limit(1))[0]) slug = `${base}-${suffix++}`
    const now = new Date().toISOString()
    const bot: typeof bots.$inferInsert = {
      suggestedApps: suggestedApps[input.templateId ?? 'custom'] ?? [],
      id: createId('bot'), slug, name: input.name, avatar: input.avatar, job: input.job,
      instructions: input.instructions, model: input.model ?? null, reasoningEffort: input.reasoningEffort ?? null,
      approvalPolicy: input.approvalPolicy, status: 'idle', createdBy: user.id, createdAt: now,
    }
    const room: typeof rooms.$inferInsert = {
      id: createId('room'), kind: 'dm', name: null, section: null, createdBy: user.id, lastMessageAt: null, lastMessagePreview: null,
    }
    await db.transaction(async (transaction) => {
      await transaction.insert(bots).values(bot)
      await transaction.insert(rooms).values(room)
      await transaction.insert(roomMembers).values([
        { roomId: room.id, memberKind: 'user', memberId: user.id, joinedAt: now },
        { roomId: room.id, memberKind: 'bot', memberId: bot.id, joinedAt: now },
      ])
    })
    await durable.writeThrough(computer, `bots/${slug}/MEMORY.md`, new Uint8Array(Buffer.from(`# ${input.name} memory\n`)), { contentType: 'text/markdown' })
    if (bot.suggestedApps?.length) {
      const names = bot.suggestedApps.map(appName), list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
      await admission.post({ roomId: room.id, authorKind: 'system', authorId: bot.id, text: `I work best with ${list}. Connect any of them?`, attachments: [{ subtype: 'welcome', suggestedApps: bot.suggestedApps, botName: bot.name }], planReplies: false })
    }
    hub.broadcastAll({ type: 'bot.updated', bot: bot as any, ts: now })
    return context.json({ bot, room }, 201)
  })

  app.get('/:id', async (context) => {
    const bot = (await db.select().from(bots).where(eq(bots.id, context.req.param('id'))).limit(1))[0]
    return bot ? context.json({ bot }) : context.json({ error: 'Bot not found' }, 404)
  })

  app.patch('/:id', async (context) => {
    const input = await parseBody(context, createBotSchema.omit({ templateId: true }).partial())
    if (isResponse(input)) return input
    const updated = (await db.update(bots).set(input).where(eq(bots.id, context.req.param('id'))).returning())[0]
    if (!updated) return context.json({ error: 'Bot not found' }, 404)
    hub.broadcastAll({ type: 'bot.updated', bot: updated as any, ts: new Date().toISOString() })
    return context.json({ bot: updated })
  })

  app.delete('/:id', async (context) => {
    const id = context.req.param('id')
    const dmRooms = await db.select({ roomId: roomMembers.roomId }).from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId)).where(and(eq(roomMembers.memberKind, 'bot'), eq(roomMembers.memberId, id), eq(rooms.kind, 'dm')))
    const deleted = await db.transaction(async (transaction) => {
      await transaction.delete(roomMembers).where(and(eq(roomMembers.memberKind, 'bot'), eq(roomMembers.memberId, id)))
      for (const room of dmRooms) await transaction.delete(rooms).where(eq(rooms.id, room.roomId))
      return (await transaction.delete(bots).where(eq(bots.id, id)).returning())[0]
    })
    return deleted ? context.json({ ok: true }) : context.json({ error: 'Bot not found' }, 404)
  })
  return app
}
