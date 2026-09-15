import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createId } from '@openstaff/shared'
import { requireAuth } from '../auth/session.js'
import { computerSessions, messages, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { readConfig } from '../config.js'
import type { AppEnv } from './context.js'
import { usageExportRoutes, usageRoutes } from './usage.js'
import { signedIn } from '../test/auth.js'

let f: Awaited<ReturnType<typeof fixture>>, app: Hono<AppEnv>

beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
  f = await fixture()
  const config = readConfig({ dataDir: f.directory, controlPlaneToken: 'control-secret', plan: 'team' })
  const dependencies = { db: f.db, config } as any
  app = new Hono<AppEnv>()
  app.route('/api/usage/export', usageExportRoutes(dependencies))
  app.use('/api/*', requireAuth(f.auth))
  app.route('/api/usage', usageRoutes(dependencies))
})

afterEach(async () => { vi.useRealTimers(); await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function addTurn(id: string, finishedAt: string, model = 'xai/test', usage: Record<string, number> = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }) {
  const messageId = createId('message')
  await f.db.insert(messages).values({ id: messageId, roomId: f.roomId, seq: Number(id.replace(/\D/g, '')) || Math.floor(Math.random() * 10000), authorKind: 'user', authorId: f.userId, text: id, mentions: [], attachments: [], createdAt: finishedAt })
  await f.db.insert(turns).values({ id, roomId: f.roomId, botId: f.botId, triggerMessageId: messageId, replyMode: 'direct', status: 'done', model, modelMessages: [], usage, computerProvider: 'e2b', startedAt: new Date(new Date(finishedAt).getTime() - 60_000).toISOString(), finishedAt })
}

it('hides export without a token and authenticates it with a bearer token', async () => {
  const hidden = new Hono<AppEnv>()
  hidden.route('/api/usage/export', usageExportRoutes({ db: f.db, config: readConfig({ dataDir: f.directory, controlPlaneToken: '' }) }))
  expect((await hidden.request('/api/usage/export')).status).toBe(404)
  expect((await app.request('/api/usage/export')).status).toBe(401)
  expect((await app.request('/api/usage/export', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
  expect((await app.request('/api/usage/export', { headers: { authorization: 'Bearer control-secret' } })).status).toBe(200)
})

it('filters and paginates finished turns and returns overlapping sessions', async () => {
  await addTurn('turn_1', '2026-09-10T10:00:00.000Z')
  await addTurn('turn_2', '2026-09-10T10:00:00.000Z')
  await addTurn('turn_3', '2026-09-12T10:00:00.000Z')
  await addTurn('turn_4', '2026-08-01T10:00:00.000Z')
  await f.db.insert(computerSessions).values([
    { id: 'cps_overlap', provider: 'e2b', externalId: 'one', startedAt: '2026-08-31T23:00:00.000Z', endedAt: '2026-09-02T00:00:00.000Z', endReason: 'stopped' },
    { id: 'cps_open', provider: 'daytona', externalId: 'two', startedAt: '2026-09-09T00:00:00.000Z', endedAt: null, endReason: null },
    { id: 'cps_old', provider: 'vercel', externalId: 'three', startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-02T00:00:00.000Z', endReason: 'stopped' },
  ])
  const path = '/api/usage/export?since=2026-09-01T00%3A00%3A00.000Z&until=2026-09-14T00%3A00%3A00.000Z&limit=2'
  const first = await (await app.request(path, { headers: { authorization: 'Bearer control-secret' } })).json() as any
  expect(first.turns.map((turn: any) => turn.id)).toEqual(['turn_1', 'turn_2'])
  expect(first.nextCursor).toBe('turn_2')
  expect(first.computerSessions.map((session: any) => session.id)).toEqual(['cps_overlap', 'cps_open'])
  const second = await (await app.request(`${path}&cursor=${first.nextCursor}`, { headers: { authorization: 'Bearer control-secret' } })).json() as any
  expect(second.turns.map((turn: any) => turn.id)).toEqual(['turn_3'])
  expect(second.nextCursor).toBeNull()
})

it('aggregates the UTC month for owners and rejects members', async () => {
  await addTurn('turn_10', '2026-09-10T10:00:00.000Z', 'xai/test', { inputTokens: 10, outputTokens: 4 })
  await addTurn('turn_11', '2026-09-11T10:00:00.000Z', 'xai/test', { inputTokens: 5, outputTokens: 1, totalTokens: 8 })
  await addTurn('turn_12', '2026-08-11T10:00:00.000Z', 'openai/old')
  await f.db.insert(computerSessions).values([
    { id: 'cps_month', provider: 'e2b', externalId: 'one', startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-01T01:30:00.000Z', endReason: 'stopped' },
    { id: 'cps_open_month', provider: 'e2b', externalId: 'two', startedAt: '2026-09-14T11:30:00.000Z', endedAt: null, endReason: null },
  ])
  const response = await app.request('/api/usage/summary', { headers: { cookie: f.cookie } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ month: '2026-09', plan: 'team', includedCreditsUsd: 20, tokens: { byModel: { 'xai/test': { inputTokens: 15, outputTokens: 5, totalTokens: 22, turns: 2 } } }, computer: { byProvider: { e2b: { minutes: 120, sessions: 2 } } } })
  const member = await signedIn(f, { email: 'member-usage@example.test', name: 'Member', role: 'member' })
  expect((await app.request('/api/usage/summary', { headers: { cookie: member.cookie } })).status).toBe(403)
})
