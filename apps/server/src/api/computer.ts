import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { COMPUTER_PROVIDERS } from '@openstaff/shared'
import { ComputerError } from '../computer/provider.js'
import { ComputerConflictError } from '../computer/manager.js'
import { LeaseError } from '../computer/lease.js'
import type { ApiDependencies, AppEnv } from './context.js'
import { isResponse, parseBody } from './helpers.js'
import { PlanLimitError } from '../plan.js'

const providerSchema = z.enum(COMPUTER_PROVIDERS)
const credentialsSchema = z.object({ values: z.record(z.string(), z.string()) }).strict()
function owner(c: Context<AppEnv>) { return c.get('user').role === 'owner' }
function message(error: unknown) { return error instanceof ComputerError ? error.message : 'Computer request failed' }

function leaseError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof LeaseError) return c.json({ error: error.code }, error.code === 'held' ? 409 : 403)
  return c.json({ error: 'Computer lease request failed' }, 400)
}

export function computerRoutes({ computer, lease }: Pick<ApiDependencies, 'computer' | 'lease'>): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/status', async (c) => c.json(await computer.status()))
  app.get('/lease', async (c) => c.json(await lease.current()))
  app.post('/lease/take', async (c) => {
    const input = await parseBody(c, z.object({ reason: z.string().max(500).optional() }))
    if (isResponse(input)) return input
    const user = c.get('user')
    try { return c.json(await lease.take({ userId: user.id, userName: user.name, reason: input.reason })) } catch (error) { return leaseError(c, error) }
  })
  app.post('/lease/heartbeat', async (c) => {
    try { return c.json(await lease.heartbeat({ userId: c.get('user').id })) } catch (error) { return leaseError(c, error) }
  })
  app.post('/lease/release', async (c) => {
    const input = await parseBody(c, z.object({ force: z.boolean().optional() }))
    if (isResponse(input)) return input
    if (input.force && !owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    try { return c.json(await lease.release({ userId: c.get('user').id, force: input.force })) } catch (error) { return leaseError(c, error) }
  })
  app.get('/providers', async (c) => c.json({ providers: await computer.providers() }))
  app.get('/storage', async (c) => c.json(await computer.storageStatus()))
  app.post('/storage/sync', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    try { await computer.syncStorage(); return c.json(await computer.storageStatus()) }
    catch (error) { return c.json({ error: message(error) }, 400) }
  })
  app.post('/restart', async (c) => { if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403); try { await computer.restart(); return c.json(await computer.status()) } catch (error) { return c.json({ error: message(error) }, 400) } })
  app.post('/stop', async (c) => { if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403); try { await computer.stop(); return c.json(await computer.status()) } catch (error) { return c.json({ error: message(error) }, 400) } })
  app.post('/destroy', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(c, z.object({ confirm: z.literal(true) }))
    if (isResponse(input)) return input
    try { await computer.destroy(); return c.json({ ok: true }) } catch (error) { return c.json({ error: message(error) }, 400) }
  })
  app.put('/provider', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(c, z.object({ id: providerSchema }))
    if (isResponse(input)) return input
    try { await computer.setProvider(input.id); return c.json(await computer.status()) } catch (error) { return error instanceof PlanLimitError ? c.json(error.body(), 402) : c.json({ error: message(error) }, error instanceof ComputerConflictError ? 409 : 400) }
  })
  app.put('/providers/:id/credentials', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    const id = providerSchema.safeParse(c.req.param('id')), input = await parseBody(c, credentialsSchema)
    if (!id.success || isResponse(input)) return c.json({ error: 'Invalid provider or credentials' }, 400)
    try { await computer.setCredentials(id.data, input.values, c.get('user').id); return c.json({ ok: true }) } catch (error) { return c.json({ error: message(error) }, 400) }
  })
  app.delete('/providers/:id/credentials', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    const id = providerSchema.safeParse(c.req.param('id')); if (!id.success) return c.json({ error: 'Invalid provider' }, 400)
    await computer.clearCredentials(id.data); return c.json({ ok: true })
  })
  app.post('/providers/:id/test', async (c) => {
    if (!owner(c)) return c.json({ error: 'Workspace owner required' }, 403)
    const id = providerSchema.safeParse(c.req.param('id')), input = await parseBody(c, credentialsSchema)
    if (!id.success || isResponse(input)) return c.json({ error: 'Invalid provider or credentials' }, 400)
    try { await computer.testCredentials(id.data, input.values); return c.json({ ok: true }) } catch (error) { return c.json({ error: message(error) }, 400) }
  })
  return app
}
