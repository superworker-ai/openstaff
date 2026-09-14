import type Docker from 'dockerode'
import { afterEach, expect, it, vi } from 'vitest'
import { ManagedDockerComputer } from './docker-provider.js'

const canary = 'private-docker-canary'
function fixture() {
  const inspect = vi.fn().mockResolvedValue({ Mounts: [{ Destination: '/workspace', Source: `/private/${canary}` }], State: { Running: false } })
  const ping = vi.fn().mockResolvedValue('OK'), start = vi.fn()
  const docker = { ping, getContainer: vi.fn(() => ({ inspect, start })) }
  const computer = new ManagedDockerComputer('/test/workspace', docker as unknown as Docker, 'test-container')
  return { computer, inspect, ping, start }
}
afterEach(() => vi.unstubAllEnvs())
it('pings first and reports an unreachable daemon without exposing the error body', async () => {
  const { computer, inspect, ping } = fixture()
  ping.mockRejectedValue(new Error(canary))
  expect(await computer.status()).toMatchObject({ status: 'error', error: 'Docker daemon unavailable' })
  expect(inspect).not.toHaveBeenCalled()
})
it('reports the wrong workspace even for a stopped container, without waking it or exposing paths', async () => {
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', '')
  const { computer, start, ping } = fixture()
  const status = await computer.status()
  expect(status).toMatchObject({ status: 'error', error: 'Computer container belongs to a different workspace' })
  expect(JSON.stringify(status)).not.toContain(canary)
  expect(start).not.toHaveBeenCalled(); expect(ping).toHaveBeenCalledOnce()
})
it('reports the exact loopback CDP URL when the endpoint is unreachable', async () => {
  vi.stubEnv('COMPUTER_CDP_URL', 'http://user:cdp-secret@127.0.0.1:55012')
  const info = {
    Id: 'desktop-id', Config: { Labels: { 'superworkers.desktop': '1' }, Image: 'superworkers/computer:local' },
    HostConfig: { PortBindings: { '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } },
    Mounts: [{ Destination: '/workspace', Source: '/test/workspace' }], State: { Running: true, Paused: false },
    NetworkSettings: { Ports: { '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '55012' }], '6901/tcp': [{ HostIp: '127.0.0.1', HostPort: '55013' }] } },
  }
  const container = { inspect: vi.fn(async () => info) }
  const docker = { ping: vi.fn(async () => 'OK'), getContainer: vi.fn(() => container) } as unknown as Docker
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response('', { status: String(input).includes('/json/version') ? 503 : 200 }))
  const status = await new ManagedDockerComputer('/test/workspace', docker, 'test-container', { viewer: 'viewer-secret', controller: 'controller-secret' }).status()
  expect(status).toMatchObject({ status: 'starting', detail: 'CDP unreachable at http://127.0.0.1:55012', desktop: { kind: 'proxied', stream: true, cdp: false } })
  expect(JSON.stringify(status)).not.toContain('secret')
  request.mockRestore()
})
it.each([
  [404, `No such image: /private/${canary}`, 'Computer image is missing'],
  [403, `Authorization: Bearer ${canary}`, 'Docker daemon denied access'],
  [500, `/private/${canary}`, 'Docker daemon could not complete the Computer operation'],
  [undefined, `/private/${canary}`, 'Computer container status could not be read'],
])('reports a safe diagnostic for Docker status %s', async (statusCode, message, expected) => {
  const { computer } = fixture()
  vi.spyOn(computer, 'containerStatus').mockRejectedValue(Object.assign(new Error(message), { statusCode }))
  const status = await computer.status()
  expect(status).toMatchObject({ status: 'error', error: expected })
  expect(JSON.stringify(status)).not.toContain(canary)
})
