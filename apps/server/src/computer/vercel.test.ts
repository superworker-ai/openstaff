import { afterEach, expect, it, vi } from 'vitest'
import { APIError, Sandbox, StreamError, type CommandFinished } from '@vercel/sandbox'
import { vercelError } from './vercel-errors.js'
import { vercelProvider } from './vercel.js'
import type { ComputerInstanceRecord } from './provider.js'

const canary = 'private-canary'
const credentials = { token: 'fixture-token', teamId: 'team_fixture', projectId: 'prj_fixture' }
const instance: ComputerInstanceRecord = { id: 'one', externalId: 'expired', provider: 'vercel', status: 'ready', metadata: {}, createdAt: '', lastSeenAt: '' }
function apiError(status: number) { return new APIError(new Response(canary, { status, statusText: canary }), { message: canary, text: canary, json: { private: canary }, sandboxName: canary }) }
function result(exitCode = 0, stdout = '', stderr = '', durationMs?: number) { return { exitCode, durationMs, stdout: vi.fn().mockResolvedValue(stdout), stderr: vi.fn().mockResolvedValue(stderr) } as unknown as CommandFinished }
function sandbox(name = 'replacement') {
  return { name, status: 'running', getDefaultUser: vi.fn().mockResolvedValue({ username: 'sandbox-user', group: 'sandbox-user' }), runCommand: vi.fn().mockResolvedValue(result()), extendTimeout: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined), fs: {
    readFile: vi.fn().mockImplementation((_path, encoding) => Promise.resolve(encoding ? 'hello' : Buffer.from('hello'))), writeFile: vi.fn().mockResolvedValue(undefined), mkdir: vi.fn().mockResolvedValue(undefined), readdir: vi.fn().mockResolvedValue([]), stat: vi.fn().mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 5 }),
  } } as unknown as Sandbox
}
async function open() {
  const stub = sandbox(); vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as Awaited<ReturnType<typeof Sandbox.create>>)
  const computer = await vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'cmp-test', instance: null, persist: vi.fn() })
  vi.mocked(stub.runCommand).mockClear(); vi.mocked(stub.extendTimeout).mockClear()
  return { computer, stub }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

it.each([[401, 'auth'], [403, 'auth'], [404, 'permanent'], [429, 'transient'], [503, 'transient']] as const)('maps Vercel API status %s without exposing vendor details', (status, kind) => {
  const error = vercelError(apiError(status))
  expect(error.kind).toBe(kind); expect(error.message).not.toContain(canary)
  if (kind === 'auth') expect(error.message).toContain('Vercel token')
})

it('maps StreamError as transient without exposing its message or session', () => {
  const error = vercelError(new StreamError('private-code', canary, canary))
  expect(error).toMatchObject({ kind: 'transient', message: 'Vercel Sandbox is temporarily unavailable' })
})

it('maps missing paths as permanent and a rejected keepalive never blocks operations', async () => {
  expect(vercelError(Object.assign(new Error(canary), { code: 'ENOENT' }))).toMatchObject({ kind: 'permanent', message: 'Vercel Sandbox path does not exist' })
  vi.useFakeTimers()
  const { computer, stub } = await open()
  vi.mocked(stub.extendTimeout).mockRejectedValue(apiError(403)); await vi.advanceTimersByTimeAsync(300_000)
  expect((await computer.exec('true')).code).toBe(0); expect(stub.extendTimeout).toHaveBeenCalledTimes(1)
})

it('recreates one missing persisted sandbox, persists it, and never loops on creation failure', async () => {
  const stub = sandbox(), get = vi.spyOn(Sandbox, 'get').mockRejectedValue(apiError(404)), create = vi.spyOn(Sandbox, 'create').mockResolvedValueOnce(stub as Awaited<ReturnType<typeof Sandbox.create>>), persist = vi.fn()
  await vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'one', instance, persist })
  expect(get).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledWith({ externalId: 'replacement', status: 'ready' })
  create.mockRejectedValue(apiError(404))
  await expect(vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'one', instance, persist: vi.fn() })).rejects.toMatchObject({ kind: 'permanent' })
  expect(create).toHaveBeenCalledTimes(2)
})

it('never creates after authentication failure and sanitizes validation', async () => {
  vi.spyOn(Sandbox, 'get').mockRejectedValue(apiError(401)); const create = vi.spyOn(Sandbox, 'create')
  await expect(vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'one', instance, persist: vi.fn() })).rejects.toMatchObject({ kind: 'auth' })
  expect(create).not.toHaveBeenCalled()
  vi.spyOn(Sandbox, 'list').mockRejectedValue(apiError(401))
  await expect(vercelProvider.validateCredentials(credentials)).rejects.toMatchObject({ kind: 'auth', message: expect.not.stringContaining(canary) })
})

it.each([false, true])('deletes a failed bootstrap only when the sandbox was newly created (attached=%s)', async (attached) => {
  const stub = sandbox(); vi.mocked(stub.runCommand).mockResolvedValue(result(1, '', canary))
  vi.spyOn(Sandbox, 'get').mockResolvedValue(stub); vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as Awaited<ReturnType<typeof Sandbox.create>>)
  await expect(vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'one', instance: attached ? instance : null, persist: vi.fn() })).rejects.toMatchObject({ message: 'Vercel Sandbox connection failed' })
  expect(stub.delete).toHaveBeenCalledTimes(attached ? 0 : 1)
})

it('bootstraps for the resolved default user and executes with cwd and a scrubbed environment', async () => {
  vi.stubEnv('XAI_API_KEY', canary)
  const stub = sandbox(); vi.spyOn(Sandbox, 'create').mockResolvedValue(stub as Awaited<ReturnType<typeof Sandbox.create>>)
  const computer = await vercelProvider.open({ credentials, workspaceRoot: '', instanceId: 'one', instance: null, persist: vi.fn() })
  expect(stub.getDefaultUser).toHaveBeenCalledTimes(1)
  expect(stub.runCommand).toHaveBeenNthCalledWith(1, { cmd: 'sh', args: ['-c', "mkdir -p /workspace && chown 'sandbox-user' /workspace"], sudo: true, timeoutMs: 30_000 })
  expect(stub.runCommand).toHaveBeenNthCalledWith(2, { cmd: 'sh', args: ['-c', 'probe=$(mktemp /workspace/.write-check.XXXXXX) && rm "$probe"'], timeoutMs: 30_000 })
  vi.mocked(stub.runCommand).mockClear(); await computer.exec("printf '%s' safe")
  const input = vi.mocked(stub.runCommand).mock.calls[0]![0]
  expect(input).toMatchObject({ cmd: 'sh', args: ['-c', "printf '%s' safe"], cwd: '/workspace', env: expect.objectContaining({ HOME: '/workspace' }) })
  expect(JSON.stringify(input)).not.toContain(canary)
})

it('returns timeout, abort, and nonzero command results without throwing', async () => {
  const { computer, stub } = await open(), run = vi.mocked(stub.runCommand)
  run.mockResolvedValueOnce(result(137, '', canary, 10))
  expect(await computer.exec('slow', { timeoutMs: 10 })).toEqual({ stdout: '', stderr: 'Terminated: timeout', code: 124 })
  run.mockResolvedValueOnce(result(137, 'partial', 'killed', 1))
  expect(await computer.exec('oom', { timeoutMs: 60_000 })).toEqual({ stdout: 'partial', stderr: 'killed', code: 137 })
  const controller = new AbortController()
  run.mockImplementationOnce((input) => new Promise((_, reject) => {
    if (input.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
    else input.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }) as never)
  const pending = computer.exec('wait', { signal: controller.signal }); controller.abort()
  expect(await pending).toEqual({ stdout: '', stderr: 'Terminated: aborted', code: 130 })
  run.mockResolvedValueOnce(result(7, 'output', 'failure'))
  expect(await computer.exec('false')).toEqual({ stdout: 'output', stderr: 'failure', code: 7 })
})

it('extends its additive timeout once per five minutes under concurrent operations', async () => {
  vi.useFakeTimers()
  const { computer, stub } = await open(), extend = vi.mocked(stub.extendTimeout)
  await computer.exec('true'); await computer.readFile('file'); expect(extend).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300_000); await Promise.all([computer.exec('true'), computer.readFile('file')])
  expect(extend).toHaveBeenCalledTimes(1); expect(extend).toHaveBeenCalledWith(300_000)
  await vi.advanceTimersByTimeAsync(299_999); await computer.mkdir('dir'); expect(extend).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await computer.exec('true'); expect(extend).toHaveBeenCalledTimes(2)
})
