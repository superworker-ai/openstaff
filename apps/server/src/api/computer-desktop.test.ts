import { createServer } from 'node:http'
import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { requireAuth } from '../auth/session.js'
import type { ComputerManager } from '../computer/manager.js'
import type { DesktopEndpoints } from '../computer/types.js'
import { fixture } from '../test/fixture.js'
import type { AppEnv } from './context.js'
import { computerDesktopRoutes } from './computer-desktop.js'
import { ComputerLeaseService } from '../computer/lease.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { readConfig } from '../config.js'

let f: Awaited<ReturnType<typeof fixture>>
let upstream: ReturnType<typeof createServer>
let app: Hono<AppEnv>
let desktop: DesktopEndpoints | null
let lease: ComputerLeaseService
let lastAuthorization: string | undefined
const secret = 'desktop-proxy-secret-canary'

beforeEach(async () => {
  f = await fixture()
  upstream = createServer((request, response) => {
    lastAuthorization = request.headers.authorization
    if (![desktopAuthorization('viewer'), desktopAuthorization('controller')].includes(request.headers.authorization ?? '')) { response.statusCode = 401; response.end(); return }
    if (request.url === '/redirect') { response.statusCode = 302; response.setHeader('location', '/next'); response.end(); return }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<p>${request.url}</p><p>cookie:${request.headers.cookie ?? 'none'}</p>`)
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const port = (upstream.address() as { port: number }).port
  desktop = { kind: 'proxied', cdpUrl: 'http://cdp.invalid', streamUrl: `http://127.0.0.1:${port}`, viewer: { user: 'viewer', password: secret }, controller: { user: 'controller', password: secret } }
  const computer = { desktop: vi.fn(async () => desktop) } as unknown as ComputerManager
  lease = new ComputerLeaseService(f.db, { broadcastAll: vi.fn(), broadcastRoom: vi.fn() } as Pick<RealtimeHub, 'broadcastAll' | 'broadcastRoom'>)
  app = new Hono<AppEnv>()
  app.use('/api/*', requireAuth(f.auth, f.db))
  app.route('/api/computer/desktop', computerDesktopRoutes({ computer, lease, config: readConfig({ dataDir: f.directory, port: 0, maxConcurrentTurns: 1, contextMessages: 10, defaultModel: 'test', publicAppUrl: 'http://app.example.test' }) }))
})

afterEach(async () => {
  lease.close()
  await new Promise<void>((resolve) => upstream.close(() => resolve()))
  await f.close()
})

function desktopAuthorization(user: 'viewer' | 'controller') {
  return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`
}

function request(path = '/', options: RequestInit = {}) {
  return app.request(`http://app.example.test/api/computer/desktop${path}`, { ...options, headers: { cookie: `${f.cookie}; upstream-cookie=must-not-pass`, ...options.headers } })
}

it('streams HTML with injected viewer auth, no client cookie, and no cache', async () => {
  const response = await request('/?autoconnect=1', { headers: { origin: 'http://app.example.test', authorization: 'Bearer must-not-pass' } })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.text()).toContain('cookie:none')
})

it('requires a session, rejects a foreign origin, rewrites locations, and redacts secrets', async () => {
  const unauthenticated = await app.request('http://app.example.test/api/computer/desktop/')
  expect(unauthenticated.status).toBe(401)
  expect((await request('/', { headers: { origin: 'http://foreign.example.test' } })).status).toBe(403)
  const redirect = await request('/redirect')
  expect(redirect.status).toBe(302)
  expect(redirect.headers.get('location')).toBe('/api/computer/desktop/next')
  desktop = null
  const unavailable = await request('/')
  expect(unavailable.status).toBe(503)
  expect(await unavailable.text()).not.toContain(secret)
})

it('uses controller identity only when the requesting user holds the lease', async () => {
  expect((await request('/?mode=control')).status).toBe(200)
  expect(lastAuthorization).toBe(desktopAuthorization('viewer'))
  await lease.take({ userId: f.userId, userName: 'Juan' })
  expect((await request('/?mode=control')).status).toBe(200)
  expect(lastAuthorization).toBe(desktopAuthorization('controller'))
  expect((await request('/')).status).toBe(200)
  expect(lastAuthorization).toBe(desktopAuthorization('viewer'))
})

it('returns external session URLs, downgrades non-holders, and rejects proxying', async () => {
  const viewerUrl = vi.fn(async () => 'https://stream.example.test/viewer')
  const controllerUrl = vi.fn(async () => 'https://stream.example.test/controller')
  desktop = { kind: 'external', cdpUrl: 'https://cdp.example.test', viewerUrl, controllerUrl, revoke: vi.fn(async () => undefined) }

  const downgraded = await request('/session?mode=control')
  expect(downgraded.status).toBe(200)
  expect(downgraded.headers.get('cache-control')).toBe('no-store')
  expect(await downgraded.json()).toEqual({ kind: 'viewer', url: 'https://stream.example.test/viewer' })
  expect(controllerUrl).not.toHaveBeenCalled()

  await lease.take({ userId: f.userId, userName: 'Juan' })
  const controlled = await request('/session?mode=control')
  expect(await controlled.json()).toEqual({ kind: 'control', url: 'https://stream.example.test/controller' })
  expect(controllerUrl).toHaveBeenCalledOnce()

  const proxied = await request('/')
  expect(proxied.status).toBe(409)
  expect(await proxied.json()).toEqual({ error: 'external-stream' })
})
