import fs from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { createId } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { createApplication, startServer, type Application, type RunningServer } from '../app.js'
import type { Config } from '../config.js'
import { automations, bots, roomMembers, rooms, users } from '../db/schema.js'

const applications: Array<Application | RunningServer> = []
const directories: string[] = []
const clock = { now: () => new Date('2026-09-14T12:00:00.000Z'), schedule: () => ({ stop() {} }) }

afterEach(async () => {
  for (const application of applications.splice(0).reverse()) {
    if ('stop' in application) await application.stop()
    else await application.close()
  }
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks(); vi.unstubAllEnvs()
})

async function application(config: Partial<Config> = {}) {
  const directory = await fs.mkdtemp(path.resolve('data-test-hosted-'))
  directories.push(directory)
  const value = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0, ...config }, automationClock: clock })
  applications.push(value)
  return value
}

async function signup(app: Application, email = 'owner@example.test') {
  const response = await app.app.request('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Owner', email, password: 'password123' }) })
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' }
}

const botInput = { name: 'Cloud bot', job: 'Test plans', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'writes' }

it('returns starter plan-limit responses at all four write paths', async () => {
  vi.stubEnv('COMPUTER_DRIVER', '')
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const running = await application({ plan: 'starter', managedKeys: true, billingUrl: 'https://billing.example' })
  expect(warnings.mock.calls.filter(([message]) => String(message).includes('stored local Computer'))).toHaveLength(1)
  expect(await (await running.app.request('/api/plan')).json()).toMatchObject({ plan: 'starter', state: 'active', managedKeys: true, billingUrl: 'https://billing.example', limits: { maxBots: 3, maxMembers: 3, maxAutomations: 3 } })
  const { cookie } = await signup(running)
  const now = new Date().toISOString()
  const owner = (await running.database.db.select({ id: users.id }).from(users).where(eq(users.email, 'owner@example.test')).limit(1))[0]!
  await running.database.db.insert(users).values([
    { id: createId('user'), email: 'two@example.test', name: 'Two', passwordHash: 'x', role: 'member', createdAt: now },
    { id: createId('user'), email: 'three@example.test', name: 'Three', passwordHash: 'x', role: 'member', createdAt: now },
  ])
  const botIds = [createId('bot'), createId('bot'), createId('bot')]
  await running.database.db.insert(bots).values(botIds.map((id, index) => ({ id, slug: `bot-${index}`, name: `Bot ${index}`, job: 'Test', instructions: '', avatar: { shape: 'circle' as const, color: '#2E90FA' }, approvalPolicy: 'writes' as const, status: 'idle' as const, createdBy: owner.id, createdAt: now })))
  const roomId = createId('room')
  await running.database.db.insert(rooms).values({ id: roomId, kind: 'dm', name: null, createdBy: owner.id })
  await running.database.db.insert(roomMembers).values({ roomId, memberKind: 'user', memberId: owner.id, joinedAt: now })
  await running.database.db.insert(automations).values([1, 2, 3].map((index) => ({ id: createId('automation'), roomId, name: `Automation ${index}`, trigger: 'schedule' as const, cron: '0 * * * *', timezone: 'UTC', prompt: 'test', targetBotIds: [], overlap: 'skip' as const, catchUp: false, enabled: true, consecutiveFailures: 0, createdBy: owner.id, createdAt: now, updatedAt: now })))
  const request = (url: string, body: unknown) => running.app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const signupLimit = await signup(running, 'four@example.test')
  const botLimit = await request('/api/bots', botInput)
  const automationLimit = await request('/api/automations', { name: 'Fourth', trigger: 'schedule', cron: '0 * * * *', timezone: 'UTC', prompt: 'test', roomId, targetBotIds: [botIds[0]], overlap: 'skip', catchUp: false, enabled: true })
  const providerLimit = await running.app.request('/api/computer/provider', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'local' }) })
  for (const [response, limit, max] of [[signupLimit.response, 'members', 3], [botLimit, 'bots', 3], [automationLimit, 'automations', 3], [providerLimit, 'computer_provider', ['docker', 'e2b', 'daytona', 'freestyle', 'vercel']]] as const) {
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ code: 'plan_limit', limit, plan: 'starter', max })
  }
  const managed = await running.app.request('/api/workspace/provider-keys', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ xai: 'customer-key' }) })
  expect(managed.status).toBe(403)
  expect(await managed.json()).toMatchObject({ code: 'managed_keys' })
})

it('keeps all four write paths unrestricted on the default self-hosted plan', async () => {
  vi.stubEnv('COMPUTER_DRIVER', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const running = await application()
  const { response: ownerResponse, cookie } = await signup(running)
  expect(ownerResponse.status).toBe(201)
  expect((await signup(running, 'member@example.test')).response.status).toBe(201)
  const botResponse = await running.app.request('/api/bots', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(botInput) })
  expect(botResponse.status).toBe(201)
  const { bot, room } = await botResponse.json() as any
  const automation = await running.app.request('/api/automations', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Daily', trigger: 'schedule', cron: '0 9 * * *', timezone: 'UTC', prompt: 'test', roomId: room.id, targetBotIds: [bot.id], overlap: 'skip', catchUp: false, enabled: true }) })
  expect(automation.status).toBe(201)
  expect((await running.app.request('/api/computer/provider', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'local' }) })).status).toBe(200)
})

it('allows only the suspended-state allowlist and rejects WebSocket upgrades', async () => {
  vi.stubEnv('COMPUTER_DRIVER', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const running = await application({ state: 'suspended' })
  for (const url of ['/api/health', '/api/ready', '/api/plan']) expect((await running.app.request(url)).status).not.toBe(402)
  expect((await running.app.request('/api/auth/me')).status).toBe(401)
  expect((await running.app.request('/api/usage/export')).status).toBe(404)
  for (const url of ['/api/bots', '/api/hooks/automations/missing', '/api/workspace']) {
    const response = await running.app.request(url)
    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({ error: 'Workspace suspended', code: 'suspended' })
  }

  const directory = await fs.mkdtemp(path.resolve('data-test-suspended-ws-'))
  directories.push(directory)
  const server = await startServer({ config: { dataDir: directory, port: 0, maxConcurrentTurns: 0, state: 'suspended' }, automationClock: clock })
  applications.push(server)
  const status = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/ws`)
    socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode ?? 0) })
    socket.once('error', reject)
  })
  expect(status).toBe(402)
})
