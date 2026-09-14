import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { turns } from '../db/schema.js'
import type { ApiDependencies, AppEnv } from './context.js'

export function screenRoutes({ db, admission, config }: ApiDependencies) {
  const app = new Hono<AppEnv>()
  app.get('/:turnId/:file', async (c) => {
    const { turnId, file } = c.req.param()
    if (!/^turn_[A-Z0-9]+$/.test(turnId) || !/^[1-9]\d*\.(?:jpg|png)$/.test(file)) return c.notFound()
    const turn = (await db.select().from(turns).where(eq(turns.id, turnId)))[0]
    if (!turn || !await admission.isMember(turn.roomId, 'user', c.get('user').id)) return c.notFound()
    try { const body = await fs.readFile(path.join(config.dataDir, 'screens', turnId, file)); return c.body(body, 200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }) } catch { return c.notFound() }
  })
  return app
}
