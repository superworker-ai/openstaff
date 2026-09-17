import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startServer } from '../app.js'
import { oauthClients, pluginOAuth, plugins } from '../db/schema.js'
import { openPluginTools } from '../plugins/mcp.js'
import { fakeOAuthServer, writeOAuthPlugin } from '../test/fake-oauth.js'

afterEach(() => vi.unstubAllEnvs())
it('HTTP OAuth connect → authenticated callback → MCP tool succeeds; expired token refreshes automatically on 401', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-oauth-')), fake = await fakeOAuthServer()
  vi.stubEnv('PUBLIC_APP_URL', '')
  const api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '', authSignup: 'open' } })
  // The ephemeral API origin is only known after listen. Providers resolve their
  // redirect at creation; production sets PUBLIC_APP_URL before server startup.
  vi.stubEnv('PUBLIC_APP_URL', api.url)
  const request = (route: string, init: RequestInit = {}) => fetch(`${api.url}${route}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers }, redirect: 'manual' })
  let cookie = ''
  try {
    const signup = await request('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ email: 'oauth@example.com', password: 'password123', name: 'Owner' }) })
    expect(signup.headers.get('set-cookie')).toContain('SameSite=Lax')
    cookie = signup.headers.get('set-cookie')!.split(';')[0]!
    const root = await writeOAuthPlugin(directory, fake.url)
    const id = await api.dependencies.installer.install(`path:${root}`), base = `/api/plugins/${id}/servers/Gmail`
    expect(await (await request(`/api/plugins/${id}/servers`)).json()).toMatchObject({ servers: [{ name: 'Gmail', protected: true, connected: false, needsClientCredentials: true }] })
    const missing = await request(`${base}/connect`, { method: 'POST', body: '{}' })
    expect(missing.status).toBe(400); expect(await missing.text()).toContain('client credentials')
    const before = await openPluginTools(api.dependencies.registry.enabled(), undefined, undefined, api.dependencies.registry.oauth)
    try {
      expect(before.tools.gmail__read_mail).toBeUndefined()
      expect(before.hiddenApps).toEqual(['Gmail'])
      expect(fake.toolCalls).toHaveLength(0)
    } finally { await before.close() }
    expect((await request(`${base}/client`, { method: 'PUT', body: JSON.stringify({ clientId: 'manual-client', clientSecret: 'manual-secret' }) })).status).toBe(200)
    const connected = await request(`${base}/connect`, { method: 'POST', body: JSON.stringify({ scopes: ['mail.read'] }) })
    expect(connected.status).toBe(200)
    const { redirectUrl } = await connected.json() as { redirectUrl: string }
    expect(new URL(redirectUrl).searchParams.get('scope')).toBe('mail.read')
    const authorized = await fetch(redirectUrl, { redirect: 'manual' }), callback = authorized.headers.get('location')!
    const callbackRoute = new URL(callback).pathname + new URL(callback).search
    expect((await fetch(`${api.url}${callbackRoute}`, { redirect: 'manual' })).status).toBe(401)
    const completed = await request(callbackRoute)
    expect(completed.status).toBe(200); expect(await completed.text()).toContain('openstaff:connected')
    // A reused state has no connect page to return to, so the popup renders the failure page in place.
    const reused = await request(callbackRoute)
    expect(reused.status).toBe(200); expect(reused.headers.get('location')).toBeNull(); expect(await reused.text()).toContain('Could not connect')
    expect(fake.grants[0]?.get('client_secret')).toBe('manual-secret')
    expect(await (await request(`/api/plugins/${id}/servers`)).json()).toMatchObject({ servers: [{ connected: true }] })
    const session = await openPluginTools(api.dependencies.registry.enabled(), undefined, undefined, api.dependencies.registry.oauth)
    try {
      expect(session.readOnly.has('gmail__read_mail')).toBe(true)
      const call = session.tools.gmail__read_mail!.execute!
      expect(await call({}, { toolCallId: 'valid', messages: [], context: {} })).toMatchObject({ content: [{ text: 'Inbox: hello from fake OAuth' }] })
      fake.expire()
      expect(await call({}, { toolCallId: 'expired', messages: [], context: {} })).toMatchObject({ content: [{ text: 'Inbox: hello from fake OAuth' }] })
      expect(fake.grants.map((grant) => grant.get('grant_type'))).toEqual(['authorization_code', 'refresh_token'])
      await expect((await api.dependencies.registry.oauth.server(id, 'Gmail')).tokens()).resolves.toMatchObject({ refresh_token: 'refresh-secret', access_token: expect.stringContaining('access-refreshed') })
    } finally { await session.close() }
    const row = (await api.database.db.select().from(pluginOAuth))[0]!
    expect(row.tokens).not.toContain('refresh-secret'); expect((await api.database.db.select().from(oauthClients))[0]?.clientSecret).not.toContain('manual-secret'); expect(row.state).toBeNull(); expect(row.codeVerifier).toBeNull()
    fake.reject()
    const rejected = await openPluginTools(api.dependencies.registry.enabled(), undefined, undefined, api.dependencies.registry.oauth)
    try {
      await expect(rejected.tools.gmail__read_mail!.execute!({}, { toolCallId: 'rejected-after-refresh', messages: [], context: {} })).rejects.toThrow('connect:Gmail')
    } finally { await rejected.close() }
    expect((await request(`${base}/connection`, { method: 'DELETE' })).status).toBe(200)
    const disconnected = await openPluginTools(api.dependencies.registry.enabled(), undefined, undefined, api.dependencies.registry.oauth)
    try {
      expect(disconnected.tools.gmail__read_mail).toBeUndefined()
      expect(disconnected.hiddenApps).toEqual(['Gmail'])
    } finally { await disconnected.close() }
    await api.database.db.delete(plugins)
    expect(await api.database.db.select().from(pluginOAuth)).toEqual([])
  } finally { await api.stop(); await fake.stop(); await fs.rm(directory, { recursive: true, force: true }) }
})
it('HTTP OAuth dynamically registers clients and lets any member start a connection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-oauth-dcr-')), fake = await fakeOAuthServer({ dcr: true })
  const api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '', authSignup: 'open', publicAppUrl: 'http://localhost:3000' } })
  try {
    const signup = async (email: string) => (await fetch(`${api.url}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'User', password: 'password123' }) })).headers.get('set-cookie')!.split(';')[0]!
    const owner = await signup('owner@example.com'), member = await signup('member@example.com')
    const id = await api.dependencies.installer.install(`path:${await writeOAuthPlugin(directory, fake.url)}`)
    const route = `${api.url}/api/plugins/${id}/servers/Gmail/connect`
    const memberStart = await fetch(route, { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: '{}' })
    expect(memberStart.status).toBe(200); expect(await memberStart.json()).toMatchObject({ redirectUrl: expect.stringContaining('/authorize') })
    expect((await fetch(`${api.url}/api/plugins`, { headers: { cookie: member } })).status).toBe(200)
    const result = await fetch(route, { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body: '{}' })
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ redirectUrl: expect.stringContaining('/authorize') })
    expect(fake.registrations).toMatchObject([{ client_name: 'OpenStaff', token_endpoint_auth_method: 'none' }])
  } finally { await api.stop(); await fake.stop(); await fs.rm(directory, { recursive: true, force: true }) }
})
