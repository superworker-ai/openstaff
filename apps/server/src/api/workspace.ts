import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { COMPUTER_PROVIDERS } from '@openstaff/shared'
import { bots, workspace } from '../db/schema.js'
import { availableApps } from '../agent/app-catalog.js'
import type { AppEnv, ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

export function workspaceRoutes({ db, keys, registry, composio, computer }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/onboarding', async (c) => {
    const configured = keys.configured()
    const model = ['xai', 'anthropic', 'openai', 'aiGateway'].some((key) => configured[key as keyof typeof configured])
    const hasBots = Boolean((await db.select({ id: bots.id }).from(bots).limit(1))[0])
    const connected = (await availableApps(registry, composio)).some((item) => item.status === 'connected')
    return c.json({ model, connected, hasBots, complete: model && connected && hasBots })
  })
  app.get('/provider-keys', (c) => c.json({ configured: keys.configured() }))
  app.put('/provider-keys', async (c) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(c, z.object({ xai: z.string().optional(), anthropic: z.string().optional(), openai: z.string().optional(), composio: z.string().optional(), aiGateway: z.string().optional() }).strict())
    if (isResponse(input)) return input
    await keys.set(input)
    if (input.composio !== undefined) composio.refreshCatalog()
    return c.json({ configured: keys.configured() })
  })
  app.get('/', async (context) => context.json({ workspace: (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0] }))
  app.patch('/', async (context) => {
    if (context.get('user').role !== 'owner') return context.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(context, z.object({ name: z.string().trim().min(1).max(100).optional(), defaultModel: z.string().min(3).optional(), replyDecisionModel: z.string().min(3).nullable().optional(), computerDriver: z.enum(COMPUTER_PROVIDERS).optional() }))
    if (isResponse(input)) return input
    if (input.computerDriver) {
      try { await computer.setProvider(input.computerDriver) } catch (error) { const message = error instanceof Error ? error.message : 'Computer provider change failed'; return context.json({ error: message }, /running|waiting/.test(message) ? 409 : 400) }
    }
    const patch = { ...input }; delete patch.computerDriver
    const value = Object.keys(patch).length
      ? (await db.update(workspace).set(patch).where(eq(workspace.id, 'workspace')).returning())[0]
      : (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
    return context.json({ workspace: value })
  })
  return app
}
