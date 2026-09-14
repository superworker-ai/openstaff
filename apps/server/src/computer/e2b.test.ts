import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthenticationError, CommandExitError, FileNotFoundError, NotFoundError, RateLimitError, Sandbox, SandboxNotFoundError, ServiceBusyError, TimeoutError, Volume } from 'e2b'
import { e2bError } from './e2b-errors.js'
import { e2bProvider } from './e2b.js'
import type { ComputerInstanceRecord } from './provider.js'

const canary = 'sdk-canary-private'
const instance: ComputerInstanceRecord = { id: 'one', externalId: 'expired', provider: 'e2b', status: 'ready', metadata: {}, createdAt: '', lastSeenAt: '' }
function sandbox() {
  return { sandboxId: 'new', commands: { run: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }) }, files: {
    makeDir: vi.fn().mockResolvedValue(true), read: vi.fn().mockImplementation((_path, opts) => Promise.resolve(opts?.format === 'bytes' ? new Uint8Array(Buffer.from('hello')) : 'hello')), write: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]), getInfo: vi.fn().mockResolvedValue({ type: 'file', size: 5 }),
  } }
}
beforeEach(() => {
  vi.stubEnv('E2B_DESKTOP', '0')
  vi.spyOn(Volume, 'list').mockResolvedValue([])
  vi.spyOn(Volume, 'create').mockResolvedValue({ volumeId: 'volume-one', name: 'openstaff-workspace-cmp-test' } as Volume)
  vi.spyOn(Volume, 'destroy').mockResolvedValue(true)
})
async function open() {
  const stub = sandbox()
  vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  const computer = await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance: null, persist: async () => {} })
  stub.commands.run.mockClear()
  return { computer, stub }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })
it('bootstraps ownership and verifies a shell write before setting cwd or HOME', async () => {
  const stub = sandbox()
  vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  const computer = await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance: null, persist: vi.fn() })
  expect(Sandbox.create).toHaveBeenCalledWith('base', expect.objectContaining({ volumeMounts: { '/workspace': expect.objectContaining({ volumeId: 'volume-one' }) } }))
  expect(stub.commands.run).toHaveBeenCalledWith('sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace && probe=$(mktemp /workspace/.write-check.XXXXXX) && rm "$probe"', { timeoutMs: 30_000 })
  await computer.exec('touch shell-write')
  expect(stub.commands.run).toHaveBeenLastCalledWith('touch shell-write', expect.objectContaining({ cwd: '/workspace', envs: expect.objectContaining({ HOME: '/workspace' }) }))
})
it('falls back to storage sync once when the account cannot create volumes', async () => {
  vi.mocked(Volume.create).mockRejectedValue(Object.assign(new Error(canary), { status: 403 }))
  const stub = sandbox(), persist = vi.fn()
  vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  vi.spyOn(Sandbox, 'getInfo').mockResolvedValue({ state: 'running' } as Awaited<ReturnType<typeof Sandbox.getInfo>>)
  const computer = await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance: null, persist })
  expect(Sandbox.create).toHaveBeenCalledWith('base', expect.not.objectContaining({ volumeMounts: expect.anything() }))
  expect(computer.runtimeCapabilities?.volume).toBe(false)
  expect((await computer.status()).detail).toContain('durable storage sync')
  expect(persist).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ e2bVolumeUnavailable: true }) }))
  const saved = persist.mock.calls[0]![0]
  vi.mocked(Volume.list).mockClear(); vi.mocked(Volume.create).mockClear()
  vi.spyOn(Sandbox, 'connect').mockRejectedValue(new SandboxNotFoundError(canary))
  await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance: { ...instance, externalId: saved.externalId, metadata: saved.metadata ?? {} }, persist: vi.fn() })
  expect(Volume.list).not.toHaveBeenCalled(); expect(Volume.create).not.toHaveBeenCalled()
})
it('reattaches a persisted volume when recreating and destroys it with the Computer', async () => {
  const persisted = { ...instance, metadata: { e2bVolumeId: 'volume-saved', e2bVolumeName: 'openstaff-workspace-one' } }
  const mounted = { volumeId: 'volume-saved', name: 'openstaff-workspace-one' } as Volume
  vi.spyOn(Volume, 'connect').mockResolvedValue(mounted)
  vi.spyOn(Sandbox, 'connect').mockRejectedValue(new SandboxNotFoundError(canary))
  const stub = sandbox(); vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  const computer = await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'one', instance: persisted, persist: vi.fn() })
  expect(Volume.create).not.toHaveBeenCalled()
  expect(Sandbox.create).toHaveBeenCalledWith('base', expect.objectContaining({ volumeMounts: { '/workspace': mounted } }))
  expect(computer.notice).toMatch(/^Recreated /)
  vi.spyOn(Sandbox, 'kill').mockResolvedValue(true)
  await computer.destroy()
  expect(Volume.destroy).toHaveBeenCalledWith('volume-saved', { apiKey: canary })
})
it.each([false, true])('cleans up failed initialization only for newly created sandboxes (attached=%s)', async (attached) => {
  const stub = sandbox()
  stub.commands.run.mockRejectedValue(new CommandExitError({ stdout: '', stderr: canary, exitCode: 1 }))
  vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  vi.spyOn(Sandbox, 'connect').mockResolvedValue(stub as unknown as Sandbox)
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true)
  await expect(e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance: attached ? instance : null, persist: vi.fn() })).rejects.toMatchObject({ message: 'E2B connection failed' })
  expect(kill).toHaveBeenCalledTimes(attached ? 0 : 1)
})
it.each([
  [AuthenticationError, 'auth'], [NotFoundError, 'permanent'], [SandboxNotFoundError, 'permanent'],
  [RateLimitError, 'transient'], [ServiceBusyError, 'transient'], [TimeoutError, 'transient'],
] as const)('maps %s by class and never returns vendor messages', (ErrorClass, kind) => {
  const error = e2bError(new ErrorClass(canary))
  expect(error.kind).toBe(kind); expect(error.message).not.toContain(canary)
  if (kind === 'auth') expect(error.message).toContain('E2B API key')
})
it('recreates an expired instance exactly once, persisting the replacement', async () => {
  const stub = sandbox(), persist = vi.fn()
  const connect = vi.spyOn(Sandbox, 'connect').mockRejectedValue(new SandboxNotFoundError(canary))
  const create = vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as unknown as Sandbox)
  await e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance, persist })
  expect(connect).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1)
  expect(persist).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'new', status: 'recreated', metadata: expect.objectContaining({ e2bVolumeId: 'volume-one' }) }))
})
it('does not create after authentication failure and sanitizes validation failures', async () => {
  vi.spyOn(Sandbox, 'connect').mockRejectedValue(new AuthenticationError(canary))
  const create = vi.spyOn(Sandbox, 'create')
  await expect(e2bProvider.open({ credentials: { apiKey: canary }, workspaceRoot: '', instanceId: 'cmp-test', instance, persist: vi.fn() })).rejects.toMatchObject({ kind: 'auth', message: 'E2B rejected the configured E2B API key' })
  expect(create).not.toHaveBeenCalled()
  vi.spyOn(Sandbox, 'list').mockReturnValue({ nextItems: vi.fn().mockRejectedValue(new AuthenticationError(canary)) } as unknown as ReturnType<typeof Sandbox.list>)
  await expect(e2bProvider.validateCredentials({ apiKey: canary })).rejects.toMatchObject({ kind: 'auth' })
})
it('refreshes timeout at most once every five minutes, including concurrent operations', async () => {
  vi.useFakeTimers()
  const { computer } = await open(), refresh = vi.spyOn(Sandbox, 'setTimeout').mockResolvedValue()
  await computer.exec('true'); await computer.readFile('file')
  expect(refresh).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300_000)
  await Promise.all([computer.exec('true'), computer.readFile('file')])
  expect(refresh).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(299_999); await computer.mkdir('dir')
  expect(refresh).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await computer.exec('true')
  expect(refresh).toHaveBeenCalledTimes(2)
})
it.each(['command', 'file'])('reconnects and retries an externally paused %s once', async (operation) => {
  const { computer, stub } = await open()
  const retry = operation === 'command' ? stub.commands.run : stub.files.read
  retry.mockRejectedValueOnce(new SandboxNotFoundError(canary))
  const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(stub as unknown as Sandbox)
  await (operation === 'command' ? computer.exec('true') : computer.readFile('file'))
  expect(connect).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledTimes(2)
  retry.mockRejectedValue(new SandboxNotFoundError(canary))
  await expect(operation === 'command' ? computer.exec('true') : computer.readFile('file')).rejects.toMatchObject({ kind: 'permanent' })
  expect(connect).toHaveBeenCalledTimes(2); expect(retry).toHaveBeenCalledTimes(4)
})
it('does not reconnect for missing files; reports timeouts and nonzero exits safely', async () => {
  const { computer, stub } = await open(), connect = vi.spyOn(Sandbox, 'connect')
  stub.files.read.mockRejectedValue(new FileNotFoundError(canary))
  await expect(computer.readFile('missing')).rejects.toMatchObject({ kind: 'permanent' })
  expect(connect).not.toHaveBeenCalled()
  stub.commands.run.mockRejectedValueOnce(new TimeoutError(canary))
  vi.spyOn(Sandbox, 'getInfo').mockResolvedValue({ state: 'running' } as Awaited<ReturnType<typeof Sandbox.getInfo>>)
  expect(await computer.exec('slow')).toEqual({ stdout: '', stderr: 'Terminated: timeout', code: 124 })
  stub.commands.run.mockRejectedValueOnce(new CommandExitError({ stdout: '', stderr: 'failed', exitCode: 2 }))
  expect((await computer.exec('false')).code).toBe(2)
})
it('recovers a paused file endpoint reported by the SDK as TimeoutError', async () => {
  const { computer, stub } = await open()
  stub.files.read.mockRejectedValueOnce(new TimeoutError(canary))
  vi.spyOn(Sandbox, 'getInfo').mockResolvedValue({ state: 'paused' } as Awaited<ReturnType<typeof Sandbox.getInfo>>)
  const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(stub as unknown as Sandbox)
  expect(await computer.readFile('file')).toBe('hello')
  expect(connect).toHaveBeenCalledTimes(1); expect(stub.files.read).toHaveBeenCalledTimes(2)
})
