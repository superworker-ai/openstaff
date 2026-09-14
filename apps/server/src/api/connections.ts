import { Hono } from 'hono'
import { z } from 'zod'
import { appName } from '@openstaff/shared'
import type { ApiDependencies, AppEnv } from './context.js'
import { connectionApproval, resumeConnections } from './connection-resume.js'
import { isResponse, parseBody } from './helpers.js'
import { connectionPopup } from './connection-popup.js'
import { availableApps } from '../agent/app-catalog.js'

export function connectionRoutes(dependencies: ApiDependencies) {
  const { composio, registry, config } = dependencies, app = new Hono<AppEnv>()
  app.get('/', async (c) => c.json({ configured: composio.configured(), connections: await composio.listConnections(), servers: await registry.oauth.list(), clients: await registry.oauth.clients.list() }))
  app.get('/apps', async (c) => c.json({ configured: composio.configured(), apps: await availableApps(registry, composio) }))
  // Connections are workspace-shared and low risk; any signed-in member may manage them.
  app.get('/callback', async (c) => {
    const id = c.req.query('approval')
    const row = id ? await connectionApproval(dependencies, id, c.get('user').id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return c.json({ error: 'Connection request not found' }, 404)
    try {
      await composio.verifyConnection(toolkit)
      await resumeConnections(dependencies, { source: 'composio', toolkit, appName: appName(toolkit) }, c.get('user').id, id)
      return connectionPopup(appName(toolkit), id, config.publicAppUrl || c.req.url)
    } catch { return c.redirect('/settings?error=Connection%20is%20not%20active%20yet.%20Complete%20sign-in%20and%20try%20again.') }
  })
  app.get('/start', async (c) => {
    const id = c.req.query('approval'), row = id ? await connectionApproval(dependencies, id, c.get('user').id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return c.json({ error: 'Connection request not found' }, 404)
    const callback = new URL('/api/connections/callback', config.publicAppUrl || c.req.url)
    callback.searchParams.set('toolkit', toolkit)
    if (id) callback.searchParams.set('approval', id)
    return c.redirect((await composio.link(toolkit, undefined, callback.href)).redirectUrl)
  })
  app.get('/complete', async (c) => {
    const id = c.req.query('approval'), row = id ? await connectionApproval(dependencies, id, c.get('user').id, true) : undefined
    if (!row?.connection || !['pending', 'approved'].includes(row.status)) return c.json({ error: 'Connection not found' }, 404)
    await resumeConnections(dependencies, row.connection, c.get('user').id, id)
    return connectionPopup(row.connection.appName, id, config.publicAppUrl || c.req.url)
  })
  app.post('/link', async (c) => {
    const input = await parseBody(c, z.object({ toolkit: z.string().min(1) }))
    if (isResponse(input)) return input
    const callback = new URL('/api/connections/callback', config.publicAppUrl || c.req.url)
    callback.searchParams.set('toolkit', input.toolkit)
    return c.json(await composio.link(input.toolkit, undefined, callback.href))
  })
  app.delete('/clients', async (c) => {
    const input = await parseBody(c, z.object({ issuer: z.string().min(1) }))
    if (isResponse(input)) return input
    await registry.oauth.clients.forget(input.issuer)
    return c.json({ ok: true })
  })
  app.delete('/:id', async (c) => { await composio.disconnect(c.req.param('id')); dependencies.hub.broadcastAll({ type: 'connection.updated', app: 'Composio', status: 'not connected', ts: new Date().toISOString() }); return c.json({ ok: true }) })
  return app
}
