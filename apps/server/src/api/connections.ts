import { setTimeout as delay } from 'node:timers/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import { appName, connectionError } from '@openstaff/shared'
import type { ApiDependencies, AppEnv } from './context.js'
import { connectionApproval, resumeConnections } from './connection-resume.js'
import { isResponse, parseBody, publicOrigin } from './helpers.js'
import { connectionFailurePopup, connectionPopup } from './connection-popup.js'
import { availableApps } from '../agent/app-catalog.js'

/** Everything under `/callback`, `/start` and `/complete` renders inside a 520×720 popup, so failures are pages, never JSON or the app shell. */
const missingRequest = (origin: string) => connectionFailurePopup('this app', 'Connection request not found or already completed.', origin)
const startHref = (toolkit: string, approvalId?: string) => `/api/connections/start?toolkit=${encodeURIComponent(toolkit)}${approvalId ? `&approval=${encodeURIComponent(approvalId)}` : ''}`

export function connectionRoutes(dependencies: ApiDependencies) {
  const { composio, registry, config } = dependencies, app = new Hono<AppEnv>()
  app.get('/', async (c) => c.json({ configured: composio.configured(), connections: await composio.listConnections(), servers: await registry.oauth.list(), clients: await registry.oauth.clients.list() }))
  app.get('/apps', async (c) => c.json({ configured: composio.configured(), apps: await availableApps(registry, composio) }))
  // Connections are workspace-shared and low risk; any signed-in member may manage them.
  app.get('/callback', async (c) => {
    const origin = publicOrigin(c, config), id = c.req.query('approval')
    const row = id ? await connectionApproval(dependencies, id, c.get('user').id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return missingRequest(origin)
    try {
      // Composio redirects here before the account flips to ACTIVE, so lose the race a few times before giving up.
      for (let attempt = 0; ; attempt++) {
        try { await composio.verifyConnection(toolkit); break }
        catch (error) { if (attempt >= 3) throw error; await delay(600) }
      }
      await resumeConnections(dependencies, { source: 'composio', toolkit, appName: appName(toolkit) }, c.get('user').id, id)
      return connectionPopup(appName(toolkit), id, origin)
    } catch (error) { return connectionFailurePopup(appName(toolkit), connectionError(error), origin, startHref(toolkit, id)) }
  })
  app.get('/start', async (c) => {
    const origin = publicOrigin(c, config), id = c.req.query('approval')
    const row = id ? await connectionApproval(dependencies, id, c.get('user').id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return missingRequest(origin)
    try {
      const callback = new URL('/api/connections/callback', origin)
      callback.searchParams.set('toolkit', toolkit)
      if (id) callback.searchParams.set('approval', id)
      return c.redirect((await composio.link(toolkit, undefined, callback.href)).redirectUrl)
    } catch (error) { return connectionFailurePopup(appName(toolkit), connectionError(error), origin, startHref(toolkit, id)) }
  })
  app.get('/complete', async (c) => {
    const origin = publicOrigin(c, config), id = c.req.query('approval')
    const row = id ? await connectionApproval(dependencies, id, c.get('user').id, true) : undefined
    if (!row?.connection || !['pending', 'approved'].includes(row.status)) return missingRequest(origin)
    try {
      await resumeConnections(dependencies, row.connection, c.get('user').id, id)
      return connectionPopup(row.connection.appName, id, origin)
    } catch (error) { return connectionFailurePopup(row.connection.appName, connectionError(error), origin) }
  })
  app.post('/link', async (c) => {
    const input = await parseBody(c, z.object({ toolkit: z.string().min(1) }))
    if (isResponse(input)) return input
    try {
      const callback = new URL('/api/connections/callback', publicOrigin(c, config))
      callback.searchParams.set('toolkit', input.toolkit)
      return c.json(await composio.link(input.toolkit, undefined, callback.href))
    } catch (error) { return c.json({ error: connectionError(error) }, 400) }
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
