import { afterEach, expect, it, vi } from 'vitest'
import { Errors, Freestyle, type Vm } from 'freestyle-sandboxes'
import { freestyleError } from './freestyle-errors.js'
import { freestyleProvider } from './freestyle.js'
import type { ComputerInstanceRecord } from './provider.js'

const canary = 'private-canary'
const instance: ComputerInstanceRecord = { id: 'one', externalId: 'expired', provider: 'freestyle', status: 'ready', metadata: {}, createdAt: '', lastSeenAt: '' }
type ErrorClass = { new(body: never): Error; readonly code: string }
function vendorError(ErrorType: unknown, extra: Record<string, unknown> = {}) { const Type = ErrorType as ErrorClass; return new Type({ code: Type.code, message: canary, ...extra } as never) }
function vm(id = 'replacement') {
  const exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '', statusCode: 0 })
  return { vmId: id, getInfo: vi.fn().mockResolvedValue({ id, state: 'running' }), start: vi.fn().mockResolvedValue({}), suspend: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({ id }), exec, fs: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('hello')), writeFile: vi.fn().mockResolvedValue(undefined), mkdir: vi.fn().mockResolvedValue(undefined), readDir: vi.fn().mockResolvedValue([]), stat: vi.fn().mockResolvedValue({ isFile: true, isDirectory: false, size: 5 }),
  } } as unknown as Vm
}
function spies() {
  const namespace = new Freestyle({ apiKey: 'fixture' }).vms
  return { get: vi.spyOn(Object.getPrototypeOf(namespace) as typeof namespace, 'get'), create: vi.spyOn(Object.getPrototypeOf(namespace) as typeof namespace, 'create') }
}
function created(value: Vm) { return { id: value.vmId, vmId: value.vmId, vm: value, domains: [] } as never }
async function open() {
  const stub = vm(), sdk = spies(); sdk.create.mockResolvedValue(created(stub))
  const computer = await freestyleProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'cmp-test', instance: null, persist: vi.fn() })
  vi.mocked(stub.exec).mockClear(); vi.mocked(stub.start).mockClear()
  return { computer, stub, sdk }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

it.each([
  [Errors.UnauthorizedError, 'auth'], [Errors.ForbiddenError, 'auth'], [Errors.VmNotFoundError, 'permanent'], [Errors.VmDeletedError, 'permanent'], [Errors.UnavailableError, 'transient'],
] as const)('maps Freestyle %s by static status without exposing its body', (ErrorType, kind) => {
  const error = freestyleError(vendorError(ErrorType, { vmId: 'vm-private' }))
  expect(error.kind).toBe(kind); expect(error.message).not.toContain(canary); expect(error.message).not.toContain('vm-private')
  if (kind === 'auth') expect(error.message).toContain('Freestyle API key')
})

it('parses plain HTTP statuses while discarding the response body', () => {
  const error = freestyleError(new Error(`HTTP error 401: ${canary}`))
  expect(error).toMatchObject({ kind: 'auth', message: 'Freestyle rejected the configured Freestyle API key' })
})

it('recreates one missing persisted VM, persists it, and never loops on creation failure', async () => {
  const missing = vm('expired'), replacement = vm(), sdk = spies(), persist = vi.fn()
  sdk.get.mockResolvedValue({ vm: missing } as never); vi.mocked(missing.getInfo).mockRejectedValue(vendorError(Errors.VmNotFoundError, { vmId: canary }))
  sdk.create.mockResolvedValueOnce(created(replacement))
  await freestyleProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance, persist })
  expect(sdk.get).toHaveBeenCalledTimes(1); expect(sdk.create).toHaveBeenCalledTimes(1)
  expect(persist).toHaveBeenCalledWith({ externalId: 'replacement', status: 'ready' })
  sdk.create.mockRejectedValue(vendorError(Errors.VmNotFoundError, { vmId: canary }))
  await expect(freestyleProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance, persist: vi.fn() })).rejects.toMatchObject({ kind: 'permanent' })
  expect(sdk.create).toHaveBeenCalledTimes(2)
})

it('never creates after attachment authentication failure and sanitizes validation', async () => {
  const attached = vm('expired'), sdk = spies()
  sdk.get.mockResolvedValue({ vm: attached } as never); vi.mocked(attached.getInfo).mockRejectedValue(vendorError(Errors.UnauthorizedError))
  await expect(freestyleProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance, persist: vi.fn() })).rejects.toMatchObject({ kind: 'auth' })
  expect(sdk.create).not.toHaveBeenCalled()
  vi.spyOn(Freestyle.prototype, 'whoami').mockRejectedValue(new Error(`Failed to get whoami: 401 ${canary}`))
  await expect(freestyleProvider.validateCredentials({ apiKey: 'fixture' })).rejects.toMatchObject({ kind: 'auth', message: expect.not.stringContaining(canary) })
})

it.each([false, true])('deletes a failed bootstrap only when the VM was newly created (attached=%s)', async (attached) => {
  const stub = vm(), sdk = spies(); vi.mocked(stub.exec).mockRejectedValue(new Error(canary))
  sdk.get.mockResolvedValue({ vm: stub } as never); sdk.create.mockResolvedValue(created(stub))
  await expect(freestyleProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance: attached ? instance : null, persist: vi.fn() })).rejects.toMatchObject({ message: 'Freestyle connection failed' })
  expect(stub.delete).toHaveBeenCalledTimes(attached ? 0 : 1)
})

it('wraps cwd and a scrubbed environment with strict shell quote escaping', async () => {
  vi.stubEnv('XAI_API_KEY', canary)
  const { computer, stub } = await open()
  await computer.exec("printf '%s' safe")
  const input = vi.mocked(stub.exec).mock.calls[0]![0] as { command: string; timeoutMs: number }
  expect(input.command).toContain("cd '/workspace'"); expect(input.command).toContain("HOME='/workspace'")
  expect(input.command).toContain("printf '\\''%s'\\'' safe"); expect(input.command).not.toContain(canary)
})

it('returns timeout, abort, and nonzero command results without throwing', async () => {
  const { computer, stub } = await open(), execute = vi.mocked(stub.exec)
  execute.mockRejectedValueOnce(vendorError(Errors.VmStartTimeoutError))
  expect(await computer.exec('slow')).toEqual({ stdout: '', stderr: 'Terminated: timeout', code: 124 })
  const controller = new AbortController(), pending = computer.exec('wait', { signal: controller.signal }); controller.abort()
  expect(await pending).toEqual({ stdout: '', stderr: 'Terminated: aborted', code: 130 })
  execute.mockResolvedValueOnce({ stdout: 'output', stderr: 'failure', statusCode: 7 })
  expect(await computer.exec('false')).toEqual({ stdout: 'output', stderr: 'failure', code: 7 })
})

it('starts and retries once after VmNotRunningError, then surfaces the second failure', async () => {
  const { computer, stub } = await open(), execute = vi.mocked(stub.exec)
  execute.mockRejectedValueOnce(vendorError(Errors.VmNotRunningError)).mockResolvedValueOnce({ stdout: 'ok', stderr: '', statusCode: 0 })
  expect((await computer.exec('true')).code).toBe(0); expect(stub.start).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(2)
  execute.mockRejectedValue(vendorError(Errors.VmNotRunningError))
  await expect(computer.exec('true')).rejects.toMatchObject({ kind: 'unavailable' })
  expect(stub.start).toHaveBeenCalledTimes(2); expect(execute).toHaveBeenCalledTimes(4)
})
