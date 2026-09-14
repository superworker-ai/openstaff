import { afterEach, expect, it, vi } from 'vitest'
import { Daytona, DaytonaError, DaytonaNotFoundError } from '@daytonaio/sdk'
import { daytonaProvider } from './daytona.js'
import { providerError, type ComputerInstanceRecord } from './provider.js'

const instance: ComputerInstanceRecord = { id: 'one', externalId: 'expired', provider: 'daytona', status: 'ready', metadata: {}, createdAt: '', lastSeenAt: '' }
afterEach(() => { vi.restoreAllMocks() })
it.each([[401, 'auth'], [403, 'auth'], [404, 'permanent'], [429, 'transient'], [503, 'transient']] as const)('maps Daytona statusCode %s without exposing headers/body', (statusCode, kind) => {
  const vendor = new DaytonaError('private-canary', statusCode)
  Object.assign(vendor, { headers: { authorization: 'private-canary' } })
  const error = providerError('Daytona', vendor)
  expect(error.kind).toBe(kind); expect(error.message).not.toContain('private-canary')
})
it('recreates a missing persisted Daytona instance exactly once', async () => {
  const sandbox = { id: 'replacement', state: 'started', fs: { createFolder: vi.fn().mockResolvedValue(undefined) } }
  const get = vi.spyOn(Daytona.prototype, 'get').mockRejectedValue(new DaytonaNotFoundError('private-canary', 404))
  const create = vi.spyOn(Daytona.prototype, 'create').mockResolvedValue(sandbox as unknown as Awaited<ReturnType<Daytona['get']>>)
  vi.spyOn(Daytona.prototype, Symbol.asyncDispose).mockResolvedValue()
  const persist = vi.fn()
  const computer = await daytonaProvider.open({ credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance, persist })
  expect(get).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1)
  expect(persist).toHaveBeenCalledWith({ externalId: 'replacement', status: 'ready' })
  await computer.close()
})
it('never recreates after authentication failure or loops if creation fails', async () => {
  const get = vi.spyOn(Daytona.prototype, 'get').mockRejectedValue(new DaytonaError('private-canary', 401))
  const create = vi.spyOn(Daytona.prototype, 'create').mockRejectedValue(new DaytonaNotFoundError('private-canary', 404))
  vi.spyOn(Daytona.prototype, Symbol.asyncDispose).mockResolvedValue()
  const input = { credentials: { apiKey: 'fixture' }, workspaceRoot: '', instanceId: 'one', instance, persist: vi.fn() }
  await expect(daytonaProvider.open(input)).rejects.toMatchObject({ kind: 'auth' }); expect(create).not.toHaveBeenCalled()
  get.mockRejectedValue(new DaytonaNotFoundError('private-canary', 404))
  await expect(daytonaProvider.open(input)).rejects.toMatchObject({ kind: 'permanent' }); expect(create).toHaveBeenCalledTimes(1)
})
