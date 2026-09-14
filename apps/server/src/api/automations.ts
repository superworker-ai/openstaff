import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { AUTOMATION_OVERLAP, AUTOMATION_TRIGGERS, MAX_AUTOMATION_TARGETS, type Automation } from '@openstaff/shared'
import { automationInvocations, automationRuns, roomMembers } from '../db/schema.js'
import { isResponse, parseBody } from './helpers.js'
import type { ApiDependencies, AppEnv } from './context.js'

const createSchema = z.object({
  name: z.string().trim().min(1).max(100), trigger: z.enum(AUTOMATION_TRIGGERS), cron: z.string().trim().min(1).nullable(), timezone: z.string().trim().min(1).default('UTC'),
  prompt: z.string().trim().min(1).max(20_000), roomId: z.string(), targetBotIds: z.array(z.string()).min(1).max(MAX_AUTOMATION_TARGETS), overlap: z.enum(AUTOMATION_OVERLAP).default('skip'), catchUp: z.boolean().default(false), enabled: z.boolean().default(true),
})
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(), trigger: z.enum(AUTOMATION_TRIGGERS).optional(), cron: z.string().trim().min(1).nullable().optional(), timezone: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(), roomId: z.string().optional(), targetBotIds: z.array(z.string()).min(1).max(MAX_AUTOMATION_TARGETS).optional(), overlap: z.enum(AUTOMATION_OVERLAP).optional(), catchUp: z.boolean().optional(), enabled: z.boolean().optional(),
})

export function automationRoutes({ db, automationService, admission, scheduler, config }: ApiDependencies) {
  const app = new Hono<AppEnv>()
  const webhookUrl = (id: string) => `${config.publicAppUrl ?? 'http://localhost:3000'}/api/hooks/automations/${id}`
  const allowed = async (id: string, userId: string): Promise<Automation | undefined> => {
    const automation = await automationService.get(id)
    return automation && await admission.isMember(automation.roomId, 'user', userId) ? automation : undefined
  }

  app.get('/', async (context) => {
    const roomId = context.req.query('roomId')
    const userId = context.get('user').id
    if (roomId && !await admission.isMember(roomId, 'user', userId)) return context.json({ error: 'Room not found' }, 404)
    const roomIds = roomId ? [roomId] : (await db.select().from(roomMembers).where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId)))).map((row) => row.roomId)
    const rows = await automationService.list(roomIds)
    return context.json({ automations: await Promise.all(rows.map(async (automation) => ({ ...automation, recent: (await automationService.history(automation.id, { limit: 10 })).map((invocation) => invocation.status) }))) })
  })

  app.post('/', async (context) => {
    const input = await parseBody(context, createSchema)
    if (isResponse(input)) return input
    if (!await admission.isMember(input.roomId, 'user', context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    try {
      const result = await automationService.create(input, context.get('user').id)
      const { webhookKey, ...automation } = result
      return context.json({ automation, ...(webhookKey ? { webhookKey, webhookUrl: webhookUrl(automation.id) } : {}) }, 201)
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : 'Invalid automation' }, 400) }
  })

  app.get('/:id', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    return context.json({ automation, invocations: await automationService.history(automation.id, { limit: 20 }) })
  })

  app.patch('/:id', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    const input = await parseBody(context, updateSchema)
    if (isResponse(input)) return input
    if (input.roomId && !await admission.isMember(input.roomId, 'user', context.get('user').id)) return context.json({ error: 'Room not found' }, 404)
    try { return context.json({ automation: await automationService.update(automation.id, input) }) }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : 'Invalid automation' }, 400) }
  })

  app.delete('/:id', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    await automationService.remove(automation.id)
    return context.json({ ok: true })
  })

  app.post('/:id/run', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    const result = await automationService.fire({ automationId: automation.id, source: 'manual', triggeredBy: context.get('user').id })
    return context.json(result, 201)
  })

  app.post('/:id/regenerate-key', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    try { return context.json({ webhookKey: await automationService.createWebhookKey(automation.id), webhookUrl: webhookUrl(automation.id) }) }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : 'Invalid automation' }, 400) }
  })

  app.get('/:id/invocations', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 20) || 20))
    return context.json({ invocations: await automationService.history(automation.id, { limit, before: context.req.query('before') }) })
  })

  app.post('/:id/invocations/:invocationId/cancel', async (context) => {
    const automation = await allowed(context.req.param('id'), context.get('user').id)
    if (!automation) return context.json({ error: 'Automation not found' }, 404)
    const invocationId = context.req.param('invocationId')
    const invocation = (await db.select().from(automationInvocations).where(and(eq(automationInvocations.id, invocationId), eq(automationInvocations.automationId, automation.id))).limit(1))[0]
    if (!invocation) return context.json({ error: 'Invocation not found' }, 404)
    const runs = await db.select().from(automationRuns).where(eq(automationRuns.invocationId, invocationId))
    let cancelled = 0
    for (const run of runs) if (run.turnId && await scheduler.cancel(run.turnId)) cancelled += 1
    return context.json({ cancelled })
  })

  return app
}
