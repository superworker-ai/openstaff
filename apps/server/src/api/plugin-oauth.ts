import { auth } from '@ai-sdk/mcp'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { connectionError, connectionPath } from '@openstaff/shared'
import { pluginOAuth } from '../db/schema.js'
import { connectPluginServer } from '../plugins/oauth.js'
import type { ApiDependencies, AppEnv } from './context.js'
import { isResponse, parseBody, publicOrigin } from './helpers.js'
import { connectionApproval, resumeConnections } from './connection-resume.js'
import { connectionFailurePopup, connectionPopup } from './connection-popup.js'

export function pluginOAuthRoutes(dependencies: ApiDependencies) {
  const { db, registry } = dependencies
  const app = new Hono<AppEnv>(), oauth = registry.oauth
  app.get('/oauth/callback', async (c) => {
    // Keep this behind requireAuth. The web proxy forwards the Lax session cookie
    // on the authorization server's top-level GET navigation.
    const origin = publicOrigin(c, dependencies.config)
    let returnPath: string | undefined
    let failedProvider: Awaited<ReturnType<typeof oauth.server>> | undefined
    try {
      const state = c.req.query('state')
      if (!state) throw new Error('Missing OAuth state')
      const row = (await db.select().from(pluginOAuth).where(eq(pluginOAuth.state, state)))[0]
      if (!row) throw new Error('Invalid or already used OAuth state')
      const provider = await oauth.server(row.pluginId, row.serverName)
      failedProvider = provider
      returnPath = connectionPath({ source: 'mcp', pluginId: row.pluginId, serverName: row.serverName, appName: row.serverName }, row.approvalId ?? undefined)
      await provider.claimState(state)
      try {
        if (c.req.query('error')) throw new Error(`Authorization declined: ${c.req.query('error')}`)
        const code = c.req.query('code')
        if (!code) throw new Error('Missing OAuth authorization code')
        const result = await auth(provider, { serverUrl: provider.serverUrl, authorizationCode: code, callbackState: state, callbackIssuer: c.req.query('iss'), scope: row.scopes?.join(' ') })
        if (result !== 'AUTHORIZED') throw new Error('Authorization did not complete. Connect again.')
      } finally { await provider.invalidateCredentials('verifier') }
      await provider.setError(null)
      await resumeConnections(dependencies, { source: 'mcp', pluginId: row.pluginId, serverName: row.serverName, appName: row.serverName }, c.get('user').id, row.approvalId ?? undefined)
      return connectionPopup(row.serverName, row.approvalId ?? undefined, origin)
    } catch (error) {
      const message = connectionError(error)
      await failedProvider?.setError(message)
      // A missing or reused state has no connect page to return to; redirecting would render the app shell in the popup.
      if (!returnPath) return connectionFailurePopup('this app', message, origin)
      return c.redirect(`${returnPath}${returnPath.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`)
    }
  })
  app.get('/:id/servers', async (c) => {
    try { return c.json({ servers: await oauth.servers(c.req.param('id')) }) }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not discover server authentication' }, 400) }
  })
  app.put('/:id/servers/:server/client', async (c) => {
    const input = await parseBody(c, z.object({ clientId: z.string().trim().min(1), clientSecret: z.string().min(1).optional() }))
    if (isResponse(input)) return input
    try {
      const provider = await oauth.server(c.req.param('id'), c.req.param('server'))
      await provider.invalidateCredentials('all')
      await provider.saveWorkspaceClient({ client_id: input.clientId, ...(input.clientSecret ? { client_secret: input.clientSecret } : {}) })
      return c.json({ ok: true })
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not save client' }, 400) }
  })
  app.post('/:id/servers/:server/connect', async (c) => {
    const input = await parseBody(c, z.object({ scopes: z.array(z.string().min(1)).optional(), approvalId: z.string().optional(), reconnect: z.boolean().optional() }))
    if (isResponse(input)) return input
    try {
      if (input.approvalId) {
        const row = await connectionApproval(dependencies, input.approvalId, c.get('user').id)
        if (row?.connection?.source !== 'mcp' || row.connection.pluginId !== c.req.param('id') || row.connection.serverName !== c.req.param('server')) return c.json({ error: 'Connection request not found' }, 404)
      }
      const provider = await oauth.server(c.req.param('id'), c.req.param('server'))
      await provider.setConnectionAttempt(input.approvalId)
      if (input.reconnect) await provider.invalidateCredentials('tokens')
      if (await provider.connected()) {
        await resumeConnections(dependencies, { source: 'mcp', pluginId: provider.pluginId, serverName: provider.serverName, appName: provider.serverName }, c.get('user').id, input.approvalId)
        return c.json({ redirectUrl: `${connectionPath({ source: 'mcp', pluginId: provider.pluginId, serverName: provider.serverName, appName: provider.serverName }, input.approvalId)}${input.approvalId ? '&' : '?'}connected=1` })
      }
      const result = await connectPluginServer(provider, input.scopes)
      if (await provider.connected()) await resumeConnections(dependencies, { source: 'mcp', pluginId: provider.pluginId, serverName: provider.serverName, appName: provider.serverName }, c.get('user').id, input.approvalId)
      return c.json(result)
    }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not connect' }, 400) }
  })
  app.delete('/:id/servers/:server/connection', async (c) => {
    try {
      const provider = await oauth.server(c.req.param('id'), c.req.param('server'))
      await provider.disconnect()
      dependencies.hub.broadcastAll({ type: 'connection.updated', app: provider.serverName, status: 'not connected', ts: new Date().toISOString() })
      return c.json({ ok: true })
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not disconnect' }, 400) }
  })
  return app
}
