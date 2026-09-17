import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApplication } from '../app.js'
import { plugins, providerKeys, workspace } from '../db/schema.js'

it('protects secrets, installs plugins, and authorizes automation mutations through HTTP', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-api-'))
  const running = await createApplication({ config: { dataDir: directory }, automationClock: { now: () => new Date(), schedule: () => ({ stop() {} }) } })
  let cookie = ''
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await running.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { response, data: await response.json() }
  }
  try {
    const signup = await request('/api/auth/signup', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
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
    const other = await request('/api/auth/signup', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' })
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

describe('/api/workspace/experimental', () => {
  it('stores the Jev experiment in settings, hides the key, and hot reloads the runtime', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-experimental-'))
    const running = await createApplication({ config: { dataDir: directory }, automationClock: { now: () => new Date(), schedule: () => ({ stop() {} }) } })
    let cookie = ''
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await running.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { response, data: await response.json() }
    }
    const row = async () => (await running.database.db.select().from(workspace))[0]
    try {
      const signup = await request('/api/auth/signup', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
      cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
      const ownerCookie = cookie
      const browserDefaults = { mode: 'off', model: 'jev-latest', timeoutMs: 2000, minConfidence: 0.35, roomIds: [] }

      const defaults = await request('/api/workspace/experimental')
      expect(defaults.response.status).toBe(200)
      expect(defaults.data).toEqual({
        jev: { mode: 'off', model: 'jev-latest', timeoutMs: 1200, roomIds: [], keyConfigured: false, keySource: null, observations: { count: 0, lastAt: null } },
        jevBrowser: { ...browserDefaults, observations: { count: 0, lastAt: null } },
      })
      expect(running.dependencies.replyDecisionManager.get()).toBeUndefined()

      const keyless = await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'shadow' } })
      expect(keyless.response.status).toBe(400)
      expect(keyless.data).toEqual({ error: 'A TypeSafe API key is required for shadow mode' })
      expect((await row())?.settings).toEqual({})
      expect((await request('/api/workspace/experimental')).data.jev.mode).toBe('off')
      expect(running.dependencies.replyDecisionManager.get()).toBeUndefined()

      const enabled = await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'shadow', apiKey: 'canary-typesafe', timeoutMs: 900, model: 'jev-1.13.0', roomIds: ['room_x'] } })
      expect(enabled.response.status).toBe(200)
      expect(enabled.data.jev).toMatchObject({ mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 900, roomIds: ['room_x'], keyConfigured: true, keySource: 'settings' })
      expect(JSON.stringify(enabled.data)).not.toContain('canary-typesafe')
      expect(JSON.stringify((await request('/api/workspace/experimental')).data)).not.toContain('canary-typesafe')
      expect(JSON.stringify(await row())).not.toContain('canary-typesafe')
      expect(JSON.stringify(await running.database.db.select().from(providerKeys))).not.toContain('canary-typesafe')
      expect((await row())?.settings).toEqual({ experimental: { jev: { mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 900, roomIds: ['room_x'] }, jevBrowser: browserDefaults } })
      // Hot reload: the live runtime sees the new experiment without restarting the server.
      expect(running.dependencies.replyDecisionManager.get()?.applies('room_x')).toBe(true)
      expect(running.dependencies.replyDecisionManager.get()?.applies('room_other')).toBe(false)

      // A partial update merges: fields the caller omits keep their stored values.
      const keyOnly = await request('/api/workspace/experimental', 'PUT', { jev: { apiKey: 'canary-typesafe-2' } })
      expect(keyOnly.response.status).toBe(200)
      expect(keyOnly.data.jev).toMatchObject({ mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 900, roomIds: ['room_x'], keyConfigured: true, keySource: 'settings' })
      expect((await row())?.settings).toEqual({ experimental: { jev: { mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 900, roomIds: ['room_x'] }, jevBrowser: browserDefaults } })
      const timeoutOnly = await request('/api/workspace/experimental', 'PUT', { jev: { timeoutMs: 2500 } })
      expect(timeoutOnly.response.status).toBe(200)
      expect(timeoutOnly.data.jev).toMatchObject({ mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 2500, roomIds: ['room_x'] })
      expect((await row())?.settings).toEqual({ experimental: { jev: { mode: 'shadow', model: 'jev-1.13.0', timeoutMs: 2500, roomIds: ['room_x'] }, jevBrowser: browserDefaults } })
      expect(running.dependencies.replyDecisionManager.get()?.applies('room_x')).toBe(true)
      for (const canary of ['canary-typesafe', 'canary-typesafe-2']) {
        expect(JSON.stringify(keyOnly.data)).not.toContain(canary)
        expect(JSON.stringify(timeoutOnly.data)).not.toContain(canary)
        expect(JSON.stringify((await request('/api/workspace/experimental')).data)).not.toContain(canary)
        expect(JSON.stringify(await row())).not.toContain(canary)
        expect(JSON.stringify(await running.database.db.select().from(providerKeys))).not.toContain(canary)
      }

      expect((await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'shadow' }, unknown: true })).response.status).toBe(400)
      expect((await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'active' } })).response.status).toBe(400)
      expect((await request('/api/workspace/provider-keys', 'PUT', { typesafe: 'x' })).response.status).toBe(400)
      expect(JSON.stringify((await request('/api/workspace/provider-keys')).data)).not.toContain('canary-typesafe')
      expect(JSON.stringify((await request('/api/workspace')).data)).not.toContain('canary-typesafe')

      const other = await request('/api/auth/signup', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' })
      cookie = other.response.headers.get('set-cookie')!.split(';')[0]!
      expect((await request('/api/workspace/experimental')).response.status).toBe(200)
      expect((await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'off' } })).response.status).toBe(403)
      cookie = ownerCookie

      const cleared = await request('/api/workspace/experimental', 'PUT', { jev: { apiKey: '', mode: 'off' } })
      expect(cleared.response.status).toBe(200)
      expect(cleared.data.jev).toMatchObject({ mode: 'off', keyConfigured: false, keySource: null })
      expect(await running.database.db.select().from(providerKeys)).toEqual([])
      expect(running.dependencies.replyDecisionManager.get()).toBeUndefined()
    } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('configures the browser action experiment from the same key without disturbing the reply experiment', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-experimental-browser-'))
    const running = await createApplication({ config: { dataDir: directory }, automationClock: { now: () => new Date(), schedule: () => ({ stop() {} }) } })
    let cookie = ''
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await running.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { response, data: await response.json() }
    }
    const row = async () => (await running.database.db.select().from(workspace))[0]
    try {
      const signup = await request('/api/auth/signup', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
      cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
      const ownerCookie = cookie
      expect((await request('/api/workspace/experimental')).data.jevBrowser).toEqual({ mode: 'off', model: 'jev-latest', timeoutMs: 2000, minConfidence: 0.35, roomIds: [], observations: { count: 0, lastAt: null } })
      expect(running.dependencies.browserActionManager.get()).toBeUndefined()

      const keyless = await request('/api/workspace/experimental', 'PUT', { jevBrowser: { mode: 'shadow' } })
      expect(keyless.response.status).toBe(400)
      expect(keyless.data).toEqual({ error: 'A TypeSafe API key is required for shadow mode' })
      expect((await row())?.settings).toEqual({})

      const enabled = await request('/api/workspace/experimental', 'PUT', { jevBrowser: { mode: 'shadow', minConfidence: 0.5, timeoutMs: 2400, roomIds: ['room_b'] }, jev: { apiKey: 'canary-browser-key' } })
      expect(enabled.response.status).toBe(200)
      expect(enabled.data.jevBrowser).toMatchObject({ mode: 'shadow', model: 'jev-latest', timeoutMs: 2400, minConfidence: 0.5, roomIds: ['room_b'] })
      expect(enabled.data.jev).toMatchObject({ mode: 'off', keyConfigured: true, keySource: 'settings' })
      expect(JSON.stringify(enabled.data)).not.toContain('canary-browser-key')
      expect(running.dependencies.browserActionManager.get()?.applies('room_b')).toBe(true)
      expect(running.dependencies.browserActionManager.get()?.applies('room_other')).toBe(false)
      // The reply experiment is still off, so the shared key alone must not start it.
      expect(running.dependencies.replyDecisionManager.get()).toBeUndefined()

      // A jev-only update keeps the stored browser settings untouched and both managers configured.
      const replyOnly = await request('/api/workspace/experimental', 'PUT', { jev: { mode: 'shadow', roomIds: ['room_a'] } })
      expect(replyOnly.response.status).toBe(200)
      expect(replyOnly.data.jevBrowser).toMatchObject({ mode: 'shadow', timeoutMs: 2400, minConfidence: 0.5, roomIds: ['room_b'] })
      expect((await row())?.settings).toEqual({ experimental: {
        jev: { mode: 'shadow', model: 'jev-latest', timeoutMs: 1200, roomIds: ['room_a'] },
        jevBrowser: { mode: 'shadow', model: 'jev-latest', timeoutMs: 2400, minConfidence: 0.5, roomIds: ['room_b'] },
      } })
      expect(running.dependencies.replyDecisionManager.get()?.applies('room_a')).toBe(true)
      expect(running.dependencies.browserActionManager.get()?.applies('room_b')).toBe(true)

      expect((await request('/api/workspace/experimental', 'PUT', { jevBrowser: { minConfidence: 2 } })).response.status).toBe(400)
      expect((await request('/api/workspace/experimental', 'PUT', { jevBrowser: { mode: 'active' } })).response.status).toBe(400)

      const other = await request('/api/auth/signup', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' })
      cookie = other.response.headers.get('set-cookie')!.split(';')[0]!
      expect((await request('/api/workspace/experimental', 'PUT', { jevBrowser: { mode: 'off' } })).response.status).toBe(403)
      cookie = ownerCookie

      const off = await request('/api/workspace/experimental', 'PUT', { jevBrowser: { mode: 'off' } })
      expect(off.response.status).toBe(200)
      expect(running.dependencies.browserActionManager.get()).toBeUndefined()
      expect(running.dependencies.replyDecisionManager.get()?.applies('room_a')).toBe(true)
    } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }) }
  })
})
