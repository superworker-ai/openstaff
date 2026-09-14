import { Hono } from 'hono'
import { turns } from '../db/schema.js'
import type { ApiDependencies, AppEnv } from './context.js'

export function usageRoutes({ db }: ApiDependencies) {
  const app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    const totals: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> = {}
    for (const turn of await db.select({ botId: turns.botId, usage: turns.usage }).from(turns)) {
      const row = totals[turn.botId] ??= { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      const number = (key: string) => typeof turn.usage?.[key] === 'number' ? turn.usage[key] as number : 0
      row.inputTokens += number('inputTokens'); row.outputTokens += number('outputTokens'); row.totalTokens += number('totalTokens') || number('inputTokens') + number('outputTokens')
    }
    return c.json({ usage: totals })
  })
  return app
}
