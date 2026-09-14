import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { computerFixture } from '../test/computer-fixture.js'
import { requireAuth } from '../auth/session.js'
import { sessions, users } from '../db/schema.js'
import { computerRoutes } from './computer.js'
import type { AppEnv } from './context.js'
import { ComputerLeaseService } from '../computer/lease.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { createId } from '@openstaff/shared'

let f: Awaited<ReturnType<typeof computerFixture>>, app: Hono<AppEnv>
let lease: ComputerLeaseService
let memberId: string
const canary = 'review-canary-never-expose-credential'
const mutations = [
  ['POST', '/restart', {}], ['POST', '/stop', {}], ['POST', '/destroy', { confirm: true }],
  ['PUT', '/provider', { id: 'e2b' }], ['PUT', '/providers/e2b/credentials', { values: { apiKey: canary } }],
  ['DELETE', '/providers/e2b/credentials', {}], ['POST', '/providers/e2b/test', { values: { apiKey: canary } }],
  ['POST', '/storage/sync', {}],
] as const
function request(method: string, url: string, body?: unknown, authenticated = true, session = 'computer-test') {
  return app.request(`/api/computer${url}`, { method, headers: { 'content-type': 'application/json', ...(authenticated ? { cookie: `sw_session=${session}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
beforeEach(async () => {
  vi.stubEnv('COMPUTER_DRIVER', ''); vi.stubEnv('E2B_API_KEY', '')
  f = await computerFixture()
  lease = new ComputerLeaseService(f.db, { broadcastAll: vi.fn(), broadcastRoom: vi.fn() } as Pick<RealtimeHub, 'broadcastAll' | 'broadcastRoom'>)
  f.manager.setLease(lease)
  memberId = createId('user')
  await f.db.insert(sessions).values({ id: 'computer-test', userId: f.userId, expiresAt: '2099-01-01T00:00:00.000Z' })
  await f.db.insert(users).values({ id: memberId, email: `${memberId}@example.test`, name: 'Member', passwordHash: 'x', avatar: null, role: 'member', createdAt: new Date().toISOString() })
  await f.db.insert(sessions).values({ id: 'computer-member', userId: memberId, expiresAt: '2099-01-01T00:00:00.000Z' })
  app = new Hono<AppEnv>()
  app.use('/api/*', requireAuth(f.db))
  app.route('/api/computer', computerRoutes({ computer: f.manager, lease }))
})
afterEach(async () => { lease.close(); await f.cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

it.each(mutations)('%s %s requires the workspace owner', async (method, url, body) => {
  await f.db.update(users).set({ role: 'member' }).where(eq(users.id, f.userId))
  expect((await request(method, url, body)).status).toBe(403)
  expect(f.open).not.toHaveBeenCalled(); expect(f.validate).not.toHaveBeenCalled()
})
it('requires authentication for status and provider metadata', async () => {
  for (const url of ['/status', '/providers', '/lease']) expect((await request('GET', url, undefined, false)).status).toBe(401)
})
it('allows members to take control and enforces holder and owner force rules', async () => {
  expect(await (await request('GET', '/lease')).json()).toMatchObject({ ownerKind: 'bot', epoch: 0 })
  expect((await request('POST', '/lease/take', {}, true, 'computer-member')).status).toBe(200)
  expect(await (await request('GET', '/status')).json()).toMatchObject({ lease: { ownerKind: 'human', ownerId: memberId, epoch: 1 } })
  expect((await request('POST', '/lease/take', {})).status).toBe(409)
  expect((await request('POST', '/lease/heartbeat', {}, true, 'computer-test')).status).toBe(403)
  expect((await request('POST', '/lease/release', { force: true }, true, 'computer-member')).status).toBe(403)
  expect((await request('POST', '/lease/release', {}, true, 'computer-test')).status).toBe(403)
  expect((await request('POST', '/lease/heartbeat', {}, true, 'computer-member')).status).toBe(200)
  expect((await request('POST', '/lease/release', { force: true })).status).toBe(200)
  expect(await (await request('GET', '/lease')).json()).toMatchObject({ ownerKind: 'bot', epoch: 2 })
})
it('returns 409 when a running turn prevents provider switching', async () => {
  await f.busy()
  expect((await request('PUT', '/provider', { id: 'e2b' })).status).toBe(409)
})
it('supports every lifecycle route and requires explicit destroy confirmation', async () => {
  expect((await request('PUT', '/provider', { id: 'e2b' })).status).toBe(200)
  expect(await (await request('GET', '/status')).json()).toMatchObject({ provider: 'e2b', status: 'ready' })
  expect(await (await request('POST', '/stop', {})).json()).toMatchObject({ status: 'paused' })
  expect(await (await request('POST', '/restart', {})).json()).toMatchObject({ status: 'ready' })
  expect((await request('POST', '/destroy', {})).status).toBe(400)
  expect(f.managed.destroy).not.toHaveBeenCalled()
  expect((await request('POST', '/destroy', { confirm: true })).status).toBe(200)
  expect(f.managed.destroy).toHaveBeenCalledTimes(1)
})
it('reports storage metadata and restricts manual sync to owners', async () => {
  expect(await (await request('GET', '/storage')).json()).toMatchObject({ kind: 'fs', healthy: true, fileCount: 0 })
  expect((await request('POST', '/storage/sync', {}, true, 'computer-member')).status).toBe(403)
  expect(await (await request('POST', '/storage/sync', {})).json()).toMatchObject({ kind: 'fs', healthy: true, lastReconcileAt: expect.any(String) })
})
it('saves/tests/deletes credentials with metadata-only responses and redacts error paths and logs', async () => {
  const logs = ['log', 'warn', 'error', 'info', 'debug'].map((method) => vi.spyOn(console, method as 'log').mockImplementation(() => {}))
  const bodies: string[] = []
  const capture = async (method: string, url: string, body?: unknown, status = 200) => {
    const response = await request(method, url, body); bodies.push(await response.text()); expect(response.status).toBe(status)
    return JSON.parse(bodies.at(-1)!)
  }
  await capture('POST', '/providers/e2b/test', { values: { apiKey: canary } })
  await capture('PUT', '/providers/e2b/credentials', { values: { apiKey: canary } })
  const metadata = await capture('GET', '/providers')
  expect(metadata.providers).toContainEqual(expect.objectContaining({ id: 'e2b', configured: true, credentialSource: 'settings' }))
  await capture('PUT', '/provider', { id: 'e2b' })
  await capture('GET', '/status')
  f.validate.mockRejectedValue(new Error(`Authorization: Bearer ${canary}; vendor body: ${canary}`))
  await capture('POST', '/providers/e2b/test', { values: { apiKey: canary } }, 400)
  await capture('PUT', '/providers/e2b/credentials', { values: { apiKey: canary } }, 400)
  await capture('DELETE', '/providers/e2b/credentials')
  expect((await capture('GET', '/providers')).providers).toContainEqual(expect.objectContaining({ id: 'e2b', configured: false, credentialSource: null }))
  f.open.mockRejectedValue(new Error(canary))
  await capture('PUT', '/provider', { id: 'e2b' }, 400)
  expect(bodies.join('\n')).not.toContain(canary)
  expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(canary)
})
