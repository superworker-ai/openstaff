import { createServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sessions } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { RealtimeHub } from './hub.js'
import { ComputerLeaseService } from '../computer/lease.js'
import type { DesktopEndpoints } from '../computer/types.js'

let f: Awaited<ReturnType<typeof fixture>>
let upstreamServer: ReturnType<typeof createServer>
let proxyServer: ReturnType<typeof createServer>
let upstreamSockets: WebSocketServer
let hub: RealtimeHub
let lease: ComputerLeaseService
let desktop: DesktopEndpoints
const viewerAuthorization = `Basic ${Buffer.from('viewer:viewer-secret').toString('base64')}`
const controllerAuthorization = `Basic ${Buffer.from('controller:controller-secret').toString('base64')}`

beforeEach(async () => {
  f = await fixture()
  await f.db.insert(sessions).values({ id: 'desktop-ws-session', userId: f.userId, expiresAt: '2099-01-01T00:00:00.000Z' })
  upstreamSockets = new WebSocketServer({ noServer: true })
  upstreamServer = createServer((request, response) => {
    response.statusCode = [viewerAuthorization, controllerAuthorization].includes(request.headers.authorization ?? '') ? 200 : 401
    response.end('desktop')
  })
  upstreamServer.on('upgrade', (request, socket, head) => {
    if (![viewerAuthorization, controllerAuthorization].includes(request.headers.authorization ?? '')) { socket.destroy(); return }
    upstreamSockets.handleUpgrade(request, socket, head, (client) => {
      client.on('message', (message, binary) => client.send(message, { binary }))
    })
  })
  await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstreamServer.address() as { port: number }).port
  desktop = {
    kind: 'proxied',
    cdpUrl: 'http://cdp.invalid',
    streamUrl: `http://127.0.0.1:${upstreamPort}`,
    viewer: { user: 'viewer', password: 'viewer-secret' },
    controller: { user: 'controller', password: 'controller-secret' },
  }
  hub = new RealtimeHub(f.db, async () => desktop, 'http://app.example.test')
  lease = new ComputerLeaseService(f.db, hub)
  hub.setLease(lease)
  proxyServer = createServer()
  hub.attach(proxyServer)
  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
})

afterEach(async () => {
  lease.close()
  hub.close()
  await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
  await new Promise<void>((resolve) => upstreamServer.close(() => resolve()))
  upstreamSockets.close()
  await f.close()
})

async function connect(path: string) {
  const port = (proxyServer.address() as { port: number }).port
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/computer/desktop/websockify${path}`, {
    headers: { cookie: 'sw_session=desktop-ws-session', origin: 'http://app.example.test', authorization: 'Bearer must-not-pass' },
  })
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject) })
  return client
}

it('bridges an authenticated same-origin desktop WebSocket with viewer credentials', async () => {
  const client = await connect('')
  const echoed = new Promise<string>((resolve) => client.once('message', (message) => resolve(message.toString())))
  client.send('visible pixels')
  expect(await echoed).toBe('visible pixels')
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
  client.close()
  await closed
})

it('closes the holder control socket with 4001 on release while a viewer survives', async () => {
  await lease.take({ userId: f.userId, userName: 'Juan' })
  const control = await connect('?mode=control')
  const viewer = await connect('')
  const controlClosed = new Promise<{ code: number; reason: string }>((resolve) => control.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))
  await lease.release({ userId: f.userId })
  await expect(controlClosed).resolves.toEqual({ code: 4001, reason: 'lease changed' })

  const echoed = new Promise<string>((resolve) => viewer.once('message', (message) => resolve(message.toString())))
  viewer.send('viewer remains')
  await expect(echoed).resolves.toBe('viewer remains')
  const viewerClosed = new Promise<void>((resolve) => viewer.once('close', () => resolve()))
  viewer.close()
  await viewerClosed
})

it('rejects an external stream bridge', async () => {
  const revoke = vi.fn(async () => undefined)
  desktop = { kind: 'external', cdpUrl: 'https://cdp.example.test', viewerUrl: vi.fn(async () => 'https://stream.example.test/viewer'), controllerUrl: vi.fn(async () => 'https://stream.example.test/control'), revoke }
  const port = (proxyServer.address() as { port: number }).port
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/computer/desktop/websockify`, {
    headers: { cookie: 'sw_session=desktop-ws-session', origin: 'http://app.example.test' },
  })
  const status = await new Promise<number | undefined>((resolve) => client.once('unexpected-response', (_request, response) => resolve(response.statusCode)))
  expect(status).toBe(409)
  expect(revoke).not.toHaveBeenCalled()
})
