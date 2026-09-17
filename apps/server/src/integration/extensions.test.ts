import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createApplication } from '../app.js'
import { plugins, providerKeys } from '../db/schema.js'

it('protects secrets, installs plugins, and authorizes automation mutations through HTTP', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-api-'))
  const running = await createApplication({ config: { dataDir: directory }, automationClock: { now: () => new Date(), schedule: () => ({ stop() {} }) } })
  let cookie = ''
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await running.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { response, data: await response.json() }
  }
  try {
    const signup = await request('/api/auth/sign-up/email', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
    cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
    const ownerCookie = cookie
    expect((await request('/api/workspace/provider-keys', 'PUT', { xai: 'canary-key' })).data).toMatchObject({ configured: { xai: true } })
    const opencode = await request('/api/workspace/provider-keys', 'PUT', { opencode: 'opencode-canary-key' })
    expect(opencode.response.status).toBe(200)
    expect(opencode.data).toMatchObject({ configured: { opencode: true } })
    expect((await request('/api/workspace/provider-keys', 'PUT', { unknown: 'key' })).response.status).toBe(400)
    expect(JSON.stringify((await request('/api/workspace/provider-keys')).data)).not.toContain('canary-key')
    expect(JSON.stringify(await running.database.db.select().from(providerKeys))).not.toContain('canary-key')
    await request('/api/workspace/provider-keys', 'PUT', { xai: '' })
    const installed = await request('/api/plugins/install', 'POST', { source: `path:${path.resolve(import.meta.dirname, '../plugins/__fixtures__/xero')}` })
    expect(installed.response.status).toBe(201)
    const id = installed.data.plugin.id
    const patched = await request(`/api/plugins/${id}`, 'PATCH', { variables: { XERO_CLIENT_ID: 'canary-client', XERO_CLIENT_SECRET: 'canary-secret' } })
    expect(patched.response.status).toBe(200)
    expect(patched.data.plugin.variablesConfigured.XERO_CLIENT_SECRET).toBe(true)
    expect(JSON.stringify(patched.data)).not.toContain('canary-secret')
    expect(JSON.stringify((await request('/api/plugins')).data)).not.toContain('canary-secret')
    expect(JSON.stringify(await running.database.db.select().from(plugins))).not.toContain('canary-secret')
    const bot = (await request('/api/bots', 'POST', { name: 'drake', job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' } })).data
    const automation = await request('/api/automations', 'POST', { name: 'Check', trigger: 'schedule', cron: '* * * * *', prompt: 'hello', targetBotIds: [bot.bot.id], roomId: bot.room.id })
    expect(automation.response.status).toBe(201)
    expect((await request(`/api/automations/${automation.data.automation.id}`, 'PATCH', { enabled: false })).data.automation.enabled).toBe(false)
    const other = await request('/api/auth/sign-up/email', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' })
    cookie = other.response.headers.get('set-cookie')!.split(';')[0]!
    expect((await request('/api/workspace/provider-keys', 'PUT', { xai: 'forbidden' })).response.status).toBe(403)
    expect((await request(`/api/plugins/${id}`, 'DELETE')).response.status).toBe(403)
    expect((await request(`/api/automations/${automation.data.automation.id}`, 'PATCH', { enabled: true })).response.status).toBe(404)
    expect((await request(`/api/automations/${automation.data.automation.id}`, 'DELETE')).response.status).toBe(404)
    expect((await request(`/api/automations/${automation.data.automation.id}/run`, 'POST')).response.status).toBe(404)
    cookie = ownerCookie
    expect((await request(`/api/automations/${automation.data.automation.id}`, 'DELETE')).response.status).toBe(200)
    expect((await request(`/api/plugins/${id}`, 'DELETE')).response.status).toBe(200)
  } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }) }
})
