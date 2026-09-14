import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { computerFixture } from '../test/computer-fixture.js'
import { ComputerConflictError, ComputerManager } from './manager.js'
import { Secrets } from '../secrets.js'
import { workspace } from '../db/schema.js'
import { ComputerLeaseService } from './lease.js'
import type { RealtimeHub } from '../realtime/hub.js'

let f: Awaited<ReturnType<typeof computerFixture>>
beforeEach(async () => { vi.stubEnv('COMPUTER_DRIVER', ''); f = await computerFixture() })
afterEach(async () => { vi.useRealTimers(); await f.cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

it.each(['running', 'waiting_approval'] as const)('rejects switching during a %s turn with the conflict error', async (status) => {
  await f.busy(status)
  await expect(f.manager.setProvider('e2b')).rejects.toBeInstanceOf(ComputerConflictError)
  expect(f.open).not.toHaveBeenCalled()
  expect(await f.manager.driver()).toBe('local')
})
it('shares one provider open across concurrent exec calls', async () => {
  await f.db.update(workspace).set({ computerDriver: 'e2b' }).where(eq(workspace.id, 'workspace'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = f.open.getMockImplementation()!
  f.open.mockImplementation(async (input) => { await gate; return original(input) })
  const operations = Promise.all([f.manager.exec('one'), f.manager.exec('two')])
  await vi.waitFor(() => expect(f.open).toHaveBeenCalledTimes(1))
  release()
  await operations
  expect(f.open).toHaveBeenCalledTimes(1)
})
it('reports no desktop operations for a provider without desktop capability', async () => {
  await expect(f.manager.captureScreen()).rejects.toThrow('Computer has no desktop')
  await expect(f.manager.desktopInput({ type: 'key', key: 'Return' })).rejects.toThrow('Computer has no desktop')
})
it('reattaches to the persisted instance on a second manager resolve', async () => {
  await f.manager.setProvider('e2b')
  expect(f.open.mock.calls[0]![0].instance).toBeNull()
  await f.manager.close()
  const next = new ComputerManager(f.directory, f.db, new Secrets(Buffer.alloc(32, 1)))
  try { await next.initialize(); expect(f.open.mock.calls[1]![0].instance?.externalId).toBe('stub-instance') }
  finally { await next.close() }
})
it('materializes durable storage when opening a non-host Computer', async () => {
  await f.durable.put('bots/drake/MEMORY.md', new Uint8Array(Buffer.from('durable')))
  await f.manager.setProvider('e2b')
  expect(f.managed.writeFile).toHaveBeenCalledWith('bots/drake/MEMORY.md', new Uint8Array(Buffer.from('durable')))
})
it('starts reconciliation off the turn-finished path', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:30:00.000Z'))
  await f.manager.setProvider('e2b')
  const sync = vi.spyOn(f.manager, 'syncStorage')
  f.manager.turnStarted(); f.manager.turnFinished()
  await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
  const status = await f.manager.storageStatus()
  expect(status.lastReconcileAt).toMatch(/^2026-09-14T12:30:00\./)
})
it('uses settings credentials over env, and restores env after clearing', async () => {
  vi.stubEnv('E2B_API_KEY', 'env-fixture')
  await f.manager.setProvider('e2b')
  expect(f.open.mock.lastCall![0].credentials.apiKey).toBe('env-fixture')
  await f.manager.setCredentials('e2b', { apiKey: 'settings-fixture' })
  await f.manager.exec('true')
  expect(f.open.mock.lastCall![0].credentials.apiKey).toBe('settings-fixture')
  await f.manager.clearCredentials('e2b'); await f.manager.exec('true')
  expect(f.open.mock.lastCall![0].credentials.apiKey).toBe('env-fixture')
})
it('status and provider polling preserve idle pause; exec resumes and uploads re-arm idle', async () => {
  vi.useFakeTimers(); vi.stubEnv('COMPUTER_IDLE_MINUTES', '1')
  await f.manager.setProvider('e2b')
  f.manager.turnStarted(); f.manager.turnFinished()
  await vi.advanceTimersByTimeAsync(30_000)
  expect((await f.manager.status()).status).toBe('ready'); await f.manager.providers()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(f.managed.stop).toHaveBeenCalledTimes(1)
  expect((await f.manager.status()).status).toBe('paused')
  await f.manager.status()
  expect(f.managed.restart).not.toHaveBeenCalled()
  await f.manager.exec('true')
  expect((await f.manager.status()).status).toBe('ready')
  await vi.advanceTimersByTimeAsync(30_000); await f.manager.writeFile('upload', 'bytes')
  await vi.advanceTimersByTimeAsync(59_999); expect(f.managed.stop).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(f.managed.stop).toHaveBeenCalledTimes(2)
})
it('shares a 15 second status cache and invalidates lifecycle changes', async () => {
  vi.useFakeTimers(); await f.manager.setProvider('e2b')
  await Promise.all([f.manager.status(), f.manager.status()])
  expect(f.managed.status).toHaveBeenCalledTimes(1)
  await f.manager.exec('true'); await f.manager.status()
  expect(f.managed.status).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(14_999); await f.manager.status()
  expect(f.managed.status).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await f.manager.status()
  expect(f.managed.status).toHaveBeenCalledTimes(2)
  await f.manager.stop(); expect((await f.manager.status()).status).toBe('paused')
  expect(f.managed.status).toHaveBeenCalledTimes(3)
  await f.manager.restart(); expect((await f.manager.status()).status).toBe('ready')
  expect(f.managed.status).toHaveBeenCalledTimes(4)
})

it('rotates an external desktop stream before lease release completes', async () => {
  const revoke = vi.fn(async () => undefined)
  f.managed.desktop = vi.fn(async () => ({ kind: 'external' as const, cdpUrl: 'https://cdp.example.test', viewerUrl: vi.fn(async () => ''), controllerUrl: vi.fn(async () => ''), revoke }))
  const lease = new ComputerLeaseService(f.db, { broadcastAll: vi.fn(), broadcastRoom: vi.fn() } as Pick<RealtimeHub, 'broadcastAll' | 'broadcastRoom'>)
  try {
    f.manager.setLease(lease)
    await f.manager.setProvider('e2b')
    await lease.take({ userId: f.userId, userName: 'Juan' })
    await lease.release({ userId: f.userId })
    expect(revoke).toHaveBeenCalledOnce()
  } finally { lease.close() }
})
