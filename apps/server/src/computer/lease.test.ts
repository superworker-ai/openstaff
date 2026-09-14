import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnEvents, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { ComputerLeaseService, LeaseError, type ComputerLeaseClock } from './lease.js'

describe('computer control lease', () => {
  let f: Awaited<ReturnType<typeof fixture>>
  let now: Date
  let service: ComputerLeaseService
  let hub: Pick<RealtimeHub, 'broadcastAll' | 'broadcastRoom'>

  beforeEach(async () => {
    vi.stubEnv('COMPUTER_TAKEOVER_MINUTES', '2')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    f = await fixture()
    now = new Date('2026-09-14T12:00:00.000Z')
    const clock: ComputerLeaseClock = { now: () => new Date(now) }
    hub = { broadcastAll: vi.fn(), broadcastRoom: vi.fn() }
    service = new ComputerLeaseService(f.db, hub, clock)
  })

  afterEach(async () => {
    service.close()
    await f.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('takes, heartbeats, releases, increments epochs, and audits active turns', async () => {
    const admitted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'work' })
    await f.db.update(turns).set({ status: 'running' }).where(eq(turns.id, admitted.turns[0]!.id))
    expect(await service.current()).toMatchObject({ ownerKind: 'bot', epoch: 0 })

    const taken = await service.take({ userId: f.userId, userName: 'Juan', reason: 'manual step' })
    expect(taken).toMatchObject({ ownerKind: 'human', ownerId: f.userId, ownerName: 'Juan', epoch: 1, reason: 'manual step', expiresAt: '2026-09-14T12:02:00.000Z' })
    now = new Date('2026-09-14T12:01:00.000Z')
    expect(await service.heartbeat({ userId: f.userId })).toMatchObject({ epoch: 1, expiresAt: '2026-09-14T12:03:00.000Z' })
    now = new Date('2026-09-14T12:01:30.000Z')
    expect(await service.release({ userId: f.userId })).toMatchObject({ ownerKind: 'bot', ownerId: null, epoch: 2, expiresAt: null, reason: null })

    expect((hub.broadcastAll as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => message.type)).toEqual(['computer.lease', 'computer.lease', 'computer.lease'])
    expect((await f.db.select().from(turnEvents).where(eq(turnEvents.turnId, admitted.turns[0]!.id))).map((event) => event.payload)).toEqual([
      { status: 'takeover', by: 'Juan' },
      { status: 'control_returned', by: 'Juan' },
    ])
  })

  it('rejects competing holders and non-holder heartbeats and releases', async () => {
    await service.take({ userId: f.userId, userName: 'Juan' })
    await expect(service.take({ userId: 'usr_someone_else', userName: 'Mina' })).rejects.toMatchObject({ code: 'held' } satisfies Partial<LeaseError>)
    await expect(service.heartbeat({ userId: 'usr_someone_else' })).rejects.toMatchObject({ code: 'not_holder' } satisfies Partial<LeaseError>)
    await expect(service.release({ userId: 'usr_someone_else' })).rejects.toMatchObject({ code: 'not_holder' } satisfies Partial<LeaseError>)
  })

  it('returns expired control to the bot with a new epoch', async () => {
    await service.take({ userId: f.userId, userName: 'Juan' })
    now = new Date('2026-09-14T12:02:01.000Z')
    expect(await service.sweepExpired()).toMatchObject({ ownerKind: 'bot', epoch: 2, reason: 'expired' })
    expect(await service.sweepExpired()).toBeNull()
  })

  it('waits for release and rejects on abort or timeout', async () => {
    await service.take({ userId: f.userId, userName: 'Juan' })
    const released = service.waitForBot(undefined, 100)
    await service.release({ userId: f.userId })
    await expect(released).resolves.toBeUndefined()

    await service.take({ userId: f.userId, userName: 'Juan' })
    const controller = new AbortController()
    const aborted = service.waitForBot(controller.signal, 100)
    controller.abort()
    await expect(aborted).rejects.toThrow('aborted')
    await expect(service.waitForBot(undefined, 5)).rejects.toThrow('Timed out waiting for bot control')
  })
})
