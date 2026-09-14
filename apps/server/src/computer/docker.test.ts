import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import Docker from 'dockerode'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { numericHttpEndpoint } from './desktop-network.js'
import { BINARY_LIMIT, execBinary, execDocker } from './docker-exec.js'
import { DockerComputer, dockerClient } from './docker.js'
import { ManagedDockerComputer } from './docker-provider.js'
import { computerEnvironment } from './environment.js'

class DesktopTestComputer extends DockerComputer {
  desktop() { return this.desktopEndpoints() }
}

function frame(type: number, text: string): Buffer { const header = Buffer.alloc(8); header[0] = type; header.writeUInt32BE(Buffer.byteLength(text), 4); return Buffer.concat([header, Buffer.from(text)]) }
function binaryFrame(type: number, bytes: Buffer): Buffer { const header = Buffer.alloc(8); header[0] = type; header.writeUInt32BE(bytes.length, 4); return Buffer.concat([header, bytes]) }
function fakeContainer(stream: Readable) {
  const execution = { start: vi.fn(async () => stream), inspect: async () => ({ ExitCode: 0 }) }
  const cleanup = { start: vi.fn(async () => undefined) }
  const container = { modem: new Docker().modem, exec: vi.fn().mockResolvedValueOnce(execution).mockResolvedValue(cleanup) }
  return { container: container as unknown as Docker.Container, calls: container.exec, cleanup }
}
afterEach(() => vi.unstubAllEnvs())

it('demuxes stdout/stderr with an output cap and scrubbed env', async () => {
  const fake = fakeContainer(Readable.from([frame(1, 'hello'), frame(2, 'warning'), frame(1, 'x'.repeat(20000))]))
  const result = await execDocker(fake.container, 'echo hi', '/workspace', computerEnvironment('/workspace', true), 1000)
  expect(result.stdout).toHaveLength(16384); expect(result.stderr).toBe('warning'); expect(result.code).toBe(0)
  expect(fake.calls.mock.calls[0]?.[0].Env).not.toContainEqual(expect.stringMatching(/^XAI_API_KEY=/))
  expect(fake.calls.mock.calls[0]?.[0].Cmd.slice(0, 2)).toEqual(['/usr/bin/env', '-i'])
})
it('kills the timed-out exec process group and closes its stream', async () => {
  const stream = new Readable({ read() {} }), fake = fakeContainer(stream)
  const result = await execDocker(fake.container, 'sleep 10', '/workspace', {}, 5)
  expect(result.code).toBe(124); expect(stream.destroyed).toBe(true)
  expect(fake.cleanup.start).toHaveBeenCalled()
})
it('demuxes binary stdout without decoding it as text', async () => {
  const bytes = Buffer.from([0, 255, 216, 0, 128, 10])
  const fake = fakeContainer(Readable.from([binaryFrame(1, bytes), frame(2, 'ignored warning')]))
  await expect(execBinary(fake.container, ['/bin/cat', '/tmp/screen.jpg'], '/workspace', {}, 1000)).resolves.toEqual(bytes)
})
it('rejects binary output over the 8 MiB cap', async () => {
  const fake = fakeContainer(Readable.from([frame(1, 'x'.repeat(BINARY_LIMIT + 1))]))
  await expect(execBinary(fake.container, ['/bin/cat', '/tmp/large'], '/workspace', {}, 1000)).rejects.toThrow('exceeded 8388608 bytes')
})
it('kills a timed-out binary exec', async () => {
  const stream = new Readable({ read() {} }), fake = fakeContainer(stream)
  await expect(execBinary(fake.container, ['/bin/sleep', '10'], '/workspace', {}, 5)).rejects.toThrow('timed out')
  expect(stream.destroyed).toBe(true)
  expect(fake.cleanup.start).toHaveBeenCalled()
})
it('creates a desktop container with named volume subpath, limits, network, and secret names', async () => {
  const canary = 'desktop-password-canary'
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', 'superworkers-data')
  vi.stubEnv('COMPUTER_HOME_VOLUME', 'superworkers-home')
  vi.stubEnv('COMPUTER_NETWORK', 'superworkers-default')
  const missing = { inspect: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) }
  const created = {
    inspect: vi.fn(async () => ({ Mounts: [{ Destination: '/workspace', Name: 'superworkers-data' }, { Destination: '/home/worker', Name: 'superworkers-home' }], State: { Running: true, Paused: false } })),
    restart: vi.fn(async () => undefined),
  }
  const createContainer = vi.fn<(options: Docker.ContainerCreateOptions) => Promise<typeof created>>(async () => created)
  const docker = { getContainer: vi.fn(() => missing), createContainer } as unknown as Docker
  const computer = new DockerComputer('/host/workspace', docker, 'desktop-test', { viewer: canary, controller: canary })
  await computer.restart()
  const options = createContainer.mock.calls[0]![0]
  expect(options.User).toBeUndefined()
  expect(options.Cmd).toBeUndefined()
  expect(options.Labels).toMatchObject({ 'superworkers.desktop': '1' })
  expect(options.ExposedPorts).toBeUndefined()
  expect(options.HostConfig).toMatchObject({ NetworkMode: 'superworkers-default', ShmSize: 1024 ** 3, Memory: 4 * 1024 ** 3, PidsLimit: 2048, CapDrop: ['ALL'] })
  expect(options.HostConfig?.Binds).toBeUndefined()
  expect(options.HostConfig?.PortBindings).toBeUndefined()
  expect(options.HostConfig?.Mounts).toEqual([
    expect.objectContaining({ Type: 'volume', Source: 'superworkers-data', Target: '/workspace', VolumeOptions: { Subpath: 'workspace' } }),
    expect.objectContaining({ Type: 'volume', Source: 'superworkers-home', Target: '/home/worker' }),
  ])
  expect(options.Env?.map((entry) => entry.slice(0, entry.indexOf('=')))).toEqual(['COMPUTER_VIEWER_PASSWORD', 'COMPUTER_CONTROLLER_PASSWORD'])
  expect(JSON.stringify({ name: options.name, image: options.Image })).not.toContain(canary)
})
it('publishes desktop ports on ephemeral loopback ports in dev mode', async () => {
  const missing = { inspect: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) }
  const created = {
    inspect: vi.fn(async () => ({ Mounts: [{ Destination: '/workspace', Source: '/host/workspace' }], State: { Running: true, Paused: false } })),
    restart: vi.fn(async () => undefined),
  }
  const createContainer = vi.fn<(options: Docker.ContainerCreateOptions) => Promise<typeof created>>(async () => created)
  const docker = { getContainer: vi.fn(() => missing), createContainer } as unknown as Docker
  await new DockerComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).restart()
  const options = createContainer.mock.calls[0]![0] as Docker.ContainerCreateOptions
  expect(options.Labels).toMatchObject({ 'superworkers.desktop': '1' })
  expect(options.ExposedPorts).toEqual({ '9222/tcp': {}, '6901/tcp': {} })
  expect(options.HostConfig?.PortBindings).toEqual({
    '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
    '6901/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
  })
  expect(options.HostConfig?.Mounts).toContainEqual(expect.objectContaining({ Source: 'superworkers-home', Target: '/home/worker' }))
})
it('creates and accepts an explicit host-path workspace bind without FUSE privileges', async () => {
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', 'bind:/mnt/archil/workspace')
  const missing = { inspect: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) }
  const created = {
    inspect: vi.fn(async () => ({ Mounts: [{ Destination: '/workspace', Source: '/mnt/archil/workspace' }], State: { Running: true, Paused: false } })),
    restart: vi.fn(async () => undefined),
  }
  const createContainer = vi.fn<(options: Docker.ContainerCreateOptions) => Promise<typeof created>>(async () => created)
  const docker = { getContainer: vi.fn(() => missing), createContainer } as unknown as Docker
  await new DockerComputer('/data/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).restart()
  const options = createContainer.mock.calls[0]![0]
  expect(options.HostConfig?.Binds).toEqual(['/mnt/archil/workspace:/workspace'])
  expect(options.HostConfig?.Privileged).toBe(false)
  expect(options.HostConfig?.CapAdd).toBeUndefined()
})
it.each([
  ['desktop label is missing', { 'superworkers.workspace': '/host/workspace' }, 'superworkers/computer:local'],
  ['configured image changed', { 'superworkers.workspace': '/host/workspace', 'superworkers.desktop': '1' }, 'old/computer:image'],
])('recreates a stale container when the %s', async (reason, labels, image) => {
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', 'superworkers-data')
  const stop = vi.fn(async () => undefined), remove = vi.fn(async () => undefined)
  const stale = {
    inspect: vi.fn(async () => ({
      Config: { Labels: labels, Image: image }, HostConfig: {},
      Mounts: [{ Destination: '/workspace', Name: 'superworkers-data' }], State: { Running: true, Paused: false },
    })),
    stop, remove,
  }
  const created = {
    inspect: vi.fn(async () => ({ Mounts: [{ Destination: '/workspace', Name: 'superworkers-data' }], State: { Running: true, Paused: false } })),
    restart: vi.fn(async () => undefined),
  }
  const createContainer = vi.fn(async () => created)
  const docker = { getContainer: vi.fn(() => stale), createContainer } as unknown as Docker
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  await new DockerComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).restart()
  expect(log).toHaveBeenCalledWith(`Recreating computer container: ${reason}`)
  expect(stop).toHaveBeenCalledWith({ t: 10 })
  expect(remove).toHaveBeenCalledOnce()
  expect(createContainer).toHaveBeenCalledOnce()
  log.mockRestore()
})
function desktopInfo(ports = { '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '55012' }], '6901/tcp': [{ HostIp: '127.0.0.1', HostPort: '55013' }] }) {
  return {
    Id: 'desktop-id', Config: { Labels: { 'superworkers.desktop': '1' }, Image: 'superworkers/computer:local' },
    HostConfig: { PortBindings: { '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } },
    Mounts: [{ Destination: '/workspace', Source: '/host/workspace' }], State: { Running: true, Paused: false },
    NetworkSettings: { Ports: ports },
  }
}
it('discovers desktop endpoints from published container ports', async () => {
  const container = { inspect: vi.fn(async () => desktopInfo()) }
  const docker = { getContainer: vi.fn(() => container) } as unknown as Docker
  const desktop = await new DesktopTestComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).desktop()
  expect(desktop).toMatchObject({ cdpUrl: 'http://127.0.0.1:55012', streamUrl: 'http://127.0.0.1:55013' })
  expect(await numericHttpEndpoint(desktop.cdpUrl)).toBe(desktop.cdpUrl)
})
it('prefers explicit desktop endpoint environment variables', async () => {
  vi.stubEnv('COMPUTER_CDP_URL', 'http://explicit-cdp:9222')
  vi.stubEnv('COMPUTER_DESKTOP_URL', 'http://explicit-desktop:6901')
  const container = { inspect: vi.fn(async () => desktopInfo()) }
  const docker = { getContainer: vi.fn(() => container) } as unknown as Docker
  const desktop = await new DesktopTestComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).desktop()
  expect(desktop).toMatchObject({ cdpUrl: 'http://explicit-cdp:9222', streamUrl: 'http://explicit-desktop:6901' })
})
it('refreshes discovered endpoints after restart', async () => {
  let cdpPort = '55012'
  const container = {
    inspect: vi.fn(async () => desktopInfo({ '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: cdpPort }], '6901/tcp': [{ HostIp: '127.0.0.1', HostPort: '55013' }] })),
    restart: vi.fn(async () => undefined),
  }
  const docker = { getContainer: vi.fn(() => container) } as unknown as Docker
  const computer = new DesktopTestComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' })
  expect((await computer.desktop()).cdpUrl).toBe('http://127.0.0.1:55012')
  cdpPort = '55014'
  await computer.restart()
  expect((await computer.desktop()).cdpUrl).toBe('http://127.0.0.1:55014')
})
it('does not expose desktop passwords in container creation errors', async () => {
  const canary = 'desktop-password-error-canary'
  const missing = { inspect: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) }
  const docker = { getContainer: vi.fn(() => missing), createContainer: vi.fn(async () => { throw new Error(canary) }) } as unknown as Docker
  const computer = new DockerComputer('/host/workspace', docker, 'desktop-test', { viewer: canary, controller: canary })
  const error = await computer.restart().catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('Computer container could not be created')
  expect((error as Error).message).not.toContain(canary)
})
it('maps a missing image to the build instruction in status', async () => {
  const missing = { inspect: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) }
  const docker = { ping: vi.fn(async () => 'OK'), getContainer: vi.fn(() => missing), createContainer: vi.fn(async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }) }) } as unknown as Docker
  const computer = new ManagedDockerComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' })
  await expect(computer.restart()).rejects.toThrow('Computer image superworkers/computer:local not found; run pnpm computer:build')
  expect(await computer.status()).toMatchObject({ status: 'error', error: 'Computer image superworkers/computer:local not found; run pnpm computer:build' })
})
describe.skipIf(process.env.DOCKER_TESTS !== '1')('real isolated Docker computer', () => {
  const name = `openstaff-test-${crypto.randomUUID()}`, home = `${name}-home`
  let directory: string, computer: DesktopTestComputer, docker: Docker
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.resolve('data-test-docker-'))
    await fs.chmod(directory, 0o777)
    docker = dockerClient()
    vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', '')
    vi.stubEnv('COMPUTER_HOME_VOLUME', home)
    vi.stubEnv('COMPUTER_NETWORK', 'bridge')
    computer = new DesktopTestComputer(directory, docker, name, { viewer: 'test-viewer-password', controller: 'test-controller-password' })
    await computer.initialize()
  })
  afterAll(async () => {
    try {
      await docker?.getContainer(name).remove({ force: true }).catch((error: { statusCode?: number }) => { if (error.statusCode !== 404) throw new Error('Test Docker container cleanup failed') })
      await docker?.getVolume(home).remove().catch(() => undefined)
    } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() }
  })
  it('runs commands, times out and shares files', async () => {
    expect((await computer.exec('node -v && python3 --version')).code).toBe(0)
    expect((await computer.exec('sleep 5', { timeoutMs: 50 })).code).not.toBe(0)
    await computer.writeFile('hello.txt', 'hello')
    expect((await computer.exec('cat hello.txt')).stdout).toBe('hello')
  }, 40_000)
  it('discovers and reaches the published Chromium endpoint', async () => {
    const desktop = await computer.desktop()
    expect(desktop.cdpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await vi.waitFor(async () => expect((await fetch(`${desktop.cdpUrl}/json/version`)).ok).toBe(true), { timeout: 30_000, interval: 500 })
  }, 40_000)
})

it('recreates a stale container when the image was rebuilt under the same tag', async () => {
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', 'superworkers-data')
  const stop = vi.fn(async () => undefined), remove = vi.fn(async () => undefined)
  const stale = {
    inspect: vi.fn(async () => ({
      Image: 'sha256:old-layers', Config: { Labels: { 'superworkers.workspace': '/host/workspace', 'superworkers.desktop': '1' }, Image: 'superworkers/computer:local' }, HostConfig: {},
      Mounts: [{ Destination: '/workspace', Name: 'superworkers-data' }], State: { Running: true, Paused: false },
    })),
    stop, remove,
  }
  const created = { inspect: vi.fn(async () => ({ Mounts: [{ Destination: '/workspace', Name: 'superworkers-data' }], State: { Running: true, Paused: false } })), restart: vi.fn(async () => undefined) }
  const createContainer = vi.fn(async () => created)
  const getImage = vi.fn(() => ({ inspect: vi.fn(async () => ({ Id: 'sha256:new-layers' })) }))
  const docker = { getContainer: vi.fn(() => stale), createContainer, getImage } as unknown as Docker
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  await new DockerComputer('/host/workspace', docker, 'desktop-test', { viewer: 'viewer', controller: 'controller' }).restart()
  expect(getImage).toHaveBeenCalledWith('superworkers/computer:local')
  expect(log).toHaveBeenCalledWith('Recreating computer container: image was rebuilt')
  expect(remove).toHaveBeenCalledOnce()
  expect(createContainer).toHaveBeenCalledOnce()
  log.mockRestore()
})
