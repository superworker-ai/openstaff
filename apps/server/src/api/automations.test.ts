import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApplication } from '../app.js'

describe('automation API', () => {
  it('creates, reads, updates, runs, pages, cancels, and protects room automations', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-automations-api-'))
    const running = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0, authSignup: 'open', publicAppUrl: 'https://openstaff.example' }, automationClock: { now: () => new Date('2026-09-12T12:00:00.000Z'), schedule: () => ({ stop() {} }) } })
    let cookie = ''
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await running.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { response, data: await response.json() as Record<string, any> }
    }
    try {
      const signup = await request('/api/auth/sign-up/email', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
      cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
      const ownerCookie = cookie
      const bot = await request('/api/bots', 'POST', { name: 'Drake', job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' } })
      const schedule = await request('/api/automations', 'POST', { name: 'Check', trigger: 'schedule', cron: '* * * * *', prompt: 'hello', targetBotIds: [bot.data.bot.id], roomId: bot.data.room.id })
      expect(schedule.response.status).toBe(201)
      const webhook = await request('/api/automations', 'POST', { name: 'Hook', trigger: 'webhook', cron: null, prompt: 'inspect', targetBotIds: [bot.data.bot.id], roomId: bot.data.room.id })
      expect(webhook.response.status).toBe(201)
      expect(webhook.data.webhookKey).toEqual(expect.any(String))
      expect(webhook.data.webhookUrl).toBe(`https://openstaff.example/api/hooks/automations/${webhook.data.automation.id}`)
      expect(webhook.data.automation).toMatchObject({ hasWebhookKey: true })
      const list = await request(`/api/automations?roomId=${bot.data.room.id}`)
      expect(list.data.automations).toHaveLength(2)
      expect(JSON.stringify(list.data)).not.toContain(webhook.data.webhookKey)
      expect(JSON.stringify(list.data)).not.toContain('webhookKeyHash')
      expect((await request(`/api/automations/${schedule.data.automation.id}`, 'PATCH', { trigger: 'webhook' })).response.status).toBe(400)
      const manual = await request(`/api/automations/${schedule.data.automation.id}/run`, 'POST')
      expect(manual.response.status).toBe(201)
      expect(manual.data).toMatchObject({ outcome: 'fired', invocation: { source: 'manual' } })
      const regenerated = await request(`/api/automations/${webhook.data.automation.id}/regenerate-key`, 'POST')
      expect(regenerated.response.status).toBe(200)
      expect(regenerated.data.webhookKey).not.toBe(webhook.data.webhookKey)
      await request(`/api/automations/${schedule.data.automation.id}`, 'PATCH', { overlap: 'queue' })
      await request(`/api/automations/${schedule.data.automation.id}/run`, 'POST')
      const history = await request(`/api/automations/${schedule.data.automation.id}/invocations?limit=1`)
      expect(history.data.invocations).toHaveLength(1)
      const before = new Date(new Date(history.data.invocations[0].createdAt).getTime() + 1).toISOString()
      expect((await request(`/api/automations/${schedule.data.automation.id}/invocations?limit=20&before=${encodeURIComponent(before)}`)).data.invocations.length).toBeGreaterThan(0)
      const cancelled = await request(`/api/automations/${schedule.data.automation.id}/invocations/${manual.data.invocation.id}/cancel`, 'POST')
      expect(cancelled.data.cancelled).toBe(1)
      const other = await request('/api/auth/sign-up/email', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' })
      cookie = other.response.headers.get('set-cookie')!.split(';')[0]!
      expect((await request(`/api/automations/${schedule.data.automation.id}`)).response.status).toBe(404)
      expect((await request(`/api/automations?roomId=${bot.data.room.id}`)).response.status).toBe(404)
      cookie = ownerCookie
      expect((await request(`/api/automations/${webhook.data.automation.id}`, 'DELETE')).data).toEqual({ ok: true })
    } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }) }
  })
})
