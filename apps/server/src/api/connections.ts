import { setTimeout as delay } from 'node:timers/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import { appName, connectionError } from '@openstaff/shared'
import type { ApiDependencies, AppEnv } from './context.js'
import { connectionApproval, resumeConnections } from './connection-resume.js'
import { isResponse, parseBody, publicOrigin } from './helpers.js'
import { connectionFailurePopup, connectionPopup } from './connection-popup.js'
import { availableApps } from '../agent/app-catalog.js'
import type { ConnectionScope, ConnectionTarget } from '../composio/service.js'
import { users } from '../db/schema.js'

/** Everything under `/callback`, `/start` and `/complete` renders inside a 520×720 popup, so failures are pages, never JSON or the app shell. */
const missingRequest = (origin: string) => connectionFailurePopup('this app', 'Connection request not found or already completed.', origin)
const startHref = (toolkit: string, scope: ConnectionScope, approvalId?: string) => `/api/connections/start?toolkit=${encodeURIComponent(toolkit)}${approvalId ? `&approval=${encodeURIComponent(approvalId)}` : ''}&scope=${scope}`
const scopeOf = (value: string | undefined): ConnectionScope => value === 'workspace' ? 'workspace' : 'member'
const target = (scope: ConnectionScope, userId: string): ConnectionTarget => scope === 'workspace' ? { scope } : { scope, userId }
/** Workspace accounts act for every member's bots, so only the people who run the workspace may add or drop one. */
const canManageWorkspace = (role: string) => role === 'owner' || role === 'admin'
const WORKSPACE_DENIED = 'Only an owner or admin can connect an app for the whole workspace.'

export function connectionRoutes(dependencies: ApiDependencies) {
  const { composio, registry, config, db } = dependencies, app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    const user = c.get('user'), manage = canManageWorkspace(user.role)
    const rows = await composio.listConnections()
    const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((row) => [row.id, row.name]))
    const visible = rows.filter((row) => row.scope === 'workspace' || row.userId === user.id || manage)
    return c.json({
      configured: composio.configured(), canManageWorkspace: manage,
      connections: visible.map((row) => ({ ...row, ...(row.userId && row.userId !== user.id ? { userName: names.get(row.userId) ?? null } : {}) })),
      servers: await registry.oauth.list(), clients: await registry.oauth.clients.list(),
    })
  })
  app.get('/apps', async (c) => c.json({ configured: composio.configured(), apps: await availableApps(registry, composio, c.get('user').id) }))
  app.get('/callback', async (c) => {
    const origin = publicOrigin(c, config), id = c.req.query('approval'), user = c.get('user'), scope = scopeOf(c.req.query('scope'))
    const row = id ? await connectionApproval(dependencies, id, user.id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return missingRequest(origin)
    try {
      // Composio redirects here before the account flips to ACTIVE, so lose the race a few times before giving up.
      for (let attempt = 0; ; attempt++) {
        try { await composio.verifyConnection(toolkit, scope, user.id); break }
        catch (error) { if (attempt >= 3) throw error; await delay(600) }
      }
      await resumeConnections(dependencies, { source: 'composio', toolkit, appName: appName(toolkit) }, user.id, id, scope)
      return connectionPopup(appName(toolkit), id, origin)
    } catch (error) { return connectionFailurePopup(appName(toolkit), connectionError(error), origin, startHref(toolkit, scope, id)) }
  })
  app.get('/start', async (c) => {
    const origin = publicOrigin(c, config), id = c.req.query('approval'), user = c.get('user'), scope = scopeOf(c.req.query('scope'))
    const row = id ? await connectionApproval(dependencies, id, user.id) : undefined
    const toolkit = row?.connection?.source === 'composio' ? row.connection.toolkit : c.req.query('toolkit')
    if (!toolkit || (id && row?.connection?.source !== 'composio')) return missingRequest(origin)
    if (scope === 'workspace' && !canManageWorkspace(user.role)) return connectionFailurePopup(appName(toolkit), WORKSPACE_DENIED, origin)
    try {
      const callback = new URL('/api/connections/callback', origin)
      callback.searchParams.set('toolkit', toolkit)
      callback.searchParams.set('scope', scope)
      if (id) callback.searchParams.set('approval', id)
      return c.redirect((await composio.link(toolkit, target(scope, user.id), undefined, callback.href)).redirectUrl)
    } catch (error) { return connectionFailurePopup(appName(toolkit), connectionError(error), origin, startHref(toolkit, scope, id)) }
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
    const input = await parseBody(c, z.object({ toolkit: z.string().min(1), scope: z.enum(['member', 'workspace']).optional() }))
    if (isResponse(input)) return input
    const user = c.get('user'), scope = input.scope ?? 'member'
    if (scope === 'workspace' && !canManageWorkspace(user.role)) return c.json({ error: WORKSPACE_DENIED, code: 'forbidden' }, 403)
    try {
      const callback = new URL('/api/connections/callback', publicOrigin(c, config))
      callback.searchParams.set('toolkit', input.toolkit)
      callback.searchParams.set('scope', scope)
      return c.json(await composio.link(input.toolkit, target(scope, user.id), undefined, callback.href))
    } catch (error) { return c.json({ error: connectionError(error) }, 400) }
  })
  app.delete('/clients', async (c) => {
    const input = await parseBody(c, z.object({ issuer: z.string().min(1) }))
    if (isResponse(input)) return input
    await registry.oauth.clients.forget(input.issuer)
    return c.json({ ok: true })
  })
  app.delete('/:id', async (c) => {
    const user = c.get('user'), manage = canManageWorkspace(user.role)
    const row = (await composio.listConnections(true)).find((item) => item.id === c.req.param('id'))
    if (!row) return c.json({ error: 'Connection not found' }, 404)
    if (row.scope === 'workspace' ? !manage : row.userId !== user.id && !manage) return c.json({ error: row.scope === 'workspace' ? 'Only an owner or admin can disconnect a workspace app.' : 'Only an owner or admin can disconnect another member’s app.', code: 'forbidden' }, 403)
    await composio.disconnect(row.id)
    dependencies.hub.broadcastAll({ type: 'connection.updated', app: 'Composio', status: 'not connected', userId: row.userId, ts: new Date().toISOString() })
    return c.json({ ok: true })
  })
  return app
}
