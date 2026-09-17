import { createHash, timingSafeEqual } from 'node:crypto'
import { and, asc, eq, gt, gte, isNull, lt, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { PLAN_LIMITS, type ComputerProviderId, type JsonValue } from '@openstaff/shared'
import { computerSessions, turns } from '../db/schema.js'
import type { ApiDependencies, AppEnv } from './context.js'

const exportQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  cursor: z.string().min(1).optional(),
})

export function usageNumber(usage: Record<string, JsonValue> | null, key: string): number {
  return typeof usage?.[key] === 'number' ? usage[key] as number : 0
}

function tokenMatches(expected: string, authorization?: string): boolean {
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(expected), digest(supplied))
}

export function usageExportRoutes({ db, config }: Pick<ApiDependencies, 'db' | 'config'>) {
  const app = new Hono<AppEnv>()
  app.get('/', async (context) => {
    if (!config.controlPlaneToken) return context.json({ error: 'Not found' }, 404)
    if (!tokenMatches(config.controlPlaneToken, context.req.header('authorization'))) return context.json({ error: 'Unauthorized' }, 401)
    const parsed = exportQuerySchema.safeParse(context.req.query())
    if (!parsed.success) return context.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    const since = parsed.data.since ?? '0000-01-01T00:00:00.000Z'
    const until = parsed.data.until ?? new Date().toISOString()
    if (since >= until) return context.json({ error: 'Invalid query window' }, 400)
    const cursor = parsed.data.cursor ? (await db.select({ id: turns.id, finishedAt: turns.finishedAt }).from(turns).where(eq(turns.id, parsed.data.cursor)).limit(1))[0] : undefined
    const afterCursor = cursor?.finishedAt ? or(gt(turns.finishedAt, cursor.finishedAt), and(eq(turns.finishedAt, cursor.finishedAt), gt(turns.id, cursor.id))) : undefined
    const rows = await db.select({ id: turns.id, roomId: turns.roomId, botId: turns.botId, model: turns.model, computerProvider: turns.computerProvider, startedAt: turns.startedAt, finishedAt: turns.finishedAt, usage: turns.usage })
      .from(turns).where(and(gte(turns.finishedAt, since), lt(turns.finishedAt, until), afterCursor)).orderBy(asc(turns.finishedAt), asc(turns.id)).limit(parsed.data.limit + 1)
    const hasNext = rows.length > parsed.data.limit
    const page = hasNext ? rows.slice(0, parsed.data.limit) : rows
    const sessions = await db.select().from(computerSessions).where(and(lt(computerSessions.startedAt, until), or(isNull(computerSessions.endedAt), gte(computerSessions.endedAt, since)))).orderBy(asc(computerSessions.startedAt), asc(computerSessions.id))
    return context.json({ turns: page, computerSessions: sessions, nextCursor: hasNext ? page.at(-1)!.id : null })
  })
  return app
}

export function usageRoutes({ db, config }: ApiDependencies) {
  const app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    const totals: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> = {}
    for (const turn of await db.select({ botId: turns.botId, usage: turns.usage }).from(turns)) {
      const row = totals[turn.botId] ??= { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      row.inputTokens += usageNumber(turn.usage, 'inputTokens'); row.outputTokens += usageNumber(turn.usage, 'outputTokens'); row.totalTokens += usageNumber(turn.usage, 'totalTokens') || usageNumber(turn.usage, 'inputTokens') + usageNumber(turn.usage, 'outputTokens')
    }
    return c.json({ usage: totals })
  })
  app.get('/summary', async (context) => {
    if (context.get('user').role !== 'owner') return context.json({ error: 'Workspace owner required' }, 403)
    const now = new Date(), month = now.toISOString().slice(0, 7)
    const startedAt = `${month}-01T00:00:00.000Z`, until = now.toISOString()
    const byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; turns: number }> = {}
    for (const turn of await db.select({ model: turns.model, usage: turns.usage }).from(turns).where(and(gte(turns.finishedAt, startedAt), lt(turns.finishedAt, until)))) {
      const row = byModel[turn.model] ??= { inputTokens: 0, outputTokens: 0, totalTokens: 0, turns: 0 }
      const inputTokens = usageNumber(turn.usage, 'inputTokens'), outputTokens = usageNumber(turn.usage, 'outputTokens')
      row.inputTokens += inputTokens; row.outputTokens += outputTokens; row.totalTokens += usageNumber(turn.usage, 'totalTokens') || inputTokens + outputTokens; row.turns += 1
    }
    const byProvider: Partial<Record<ComputerProviderId, { minutes: number; sessions: number }>> = {}
    for (const session of await db.select().from(computerSessions).where(and(lt(computerSessions.startedAt, until), or(isNull(computerSessions.endedAt), gte(computerSessions.endedAt, startedAt))))) {
      const start = Math.max(new Date(session.startedAt).getTime(), new Date(startedAt).getTime())
      const end = Math.min(session.endedAt ? new Date(session.endedAt).getTime() : now.getTime(), now.getTime())
      const row = byProvider[session.provider] ??= { minutes: 0, sessions: 0 }
      row.minutes += Math.max(0, end - start) / 60_000; row.sessions += 1
    }
    return context.json({ month, plan: config.plan, includedCreditsUsd: PLAN_LIMITS[config.plan].includedCreditsUsd, tokens: { byModel }, computer: { byProvider } })
  })
  return app
}
