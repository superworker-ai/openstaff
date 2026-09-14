import { and, eq, inArray, max } from 'drizzle-orm'
import { createId, type ComputerLease, type JsonValue, type TurnEvent } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { computerLease, turnEvents, turns } from '../db/schema.js'
import type { RealtimeHub } from '../realtime/hub.js'

export type LeaseErrorCode = 'held' | 'not_holder'

export class LeaseError extends Error {
  constructor(readonly code: LeaseErrorCode) {
    super(code === 'held' ? 'The computer is already controlled by another person' : 'You do not hold the computer control lease')
    this.name = 'LeaseError'
  }
}

export interface ComputerLeaseClock { now(): Date }
export interface ComputerLeaseGate {
  current(): Promise<ComputerLease>
  waitForBot(signal?: AbortSignal): Promise<void>
}
export interface ComputerLeaseSource extends ComputerLeaseGate {
  onChange(listener: (lease: ComputerLease) => void | Promise<void>): () => void
}

type LeaseHub = Pick<RealtimeHub, 'broadcastAll' | 'broadcastRoom'>
type LeaseRow = typeof computerLease.$inferSelect

const systemClock: ComputerLeaseClock = { now: () => new Date() }

function publicLease(row: LeaseRow): ComputerLease {
  return {
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    epoch: row.epoch,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    reason: row.reason,
  }
}

function takeoverDurationMs(): number {
  const configured = Number(process.env.COMPUTER_TAKEOVER_MINUTES ?? 15)
  return (Number.isFinite(configured) && configured > 0 ? configured : 15) * 60_000
}

function takeoverWaitMs(): number {
  const configured = Number(process.env.COMPUTER_TAKEOVER_WAIT_MS ?? 10 * 60_000)
  return Number.isFinite(configured) && configured > 0 ? configured : 10 * 60_000
}

export class ComputerLeaseService implements ComputerLeaseSource {
  private readonly listeners = new Set<(lease: ComputerLease) => void | Promise<void>>()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly sweepTimer: ReturnType<typeof setInterval>

  constructor(private readonly db: Database, private readonly hub: LeaseHub, private readonly clock: ComputerLeaseClock = systemClock) {
    this.sweepTimer = setInterval(() => { void this.sweepExpired().catch(() => console.warn('Computer lease expiry sweep failed')) }, 30_000)
    this.sweepTimer.unref()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  private async row(): Promise<LeaseRow> {
    const row = (await this.db.select().from(computerLease).where(eq(computerLease.id, 'workspace')).limit(1))[0]
    if (!row) throw new Error('Computer lease is unavailable')
    return row
  }

  private expired(row: LeaseRow, now = this.clock.now()): boolean {
    return row.ownerKind === 'human' && Boolean(row.expiresAt) && row.expiresAt! <= now.toISOString()
  }

  async current(): Promise<ComputerLease> {
    return this.serialize(async () => {
      const row = await this.row()
      if (!this.expired(row)) return publicLease(row)
      return this.returnToBot(row, 'expired')
    })
  }

  async take(input: { userId: string; userName: string; reason?: string }): Promise<ComputerLease> {
    return this.serialize(async () => {
      const row = await this.row()
      if (row.ownerKind === 'human' && !this.expired(row) && row.ownerId !== input.userId) throw new LeaseError('held')
      const now = this.clock.now()
      const [updated] = await this.db.update(computerLease).set({
        ownerKind: 'human', ownerId: input.userId, ownerName: input.userName, epoch: row.epoch + 1,
        acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + takeoverDurationMs()).toISOString(),
        heartbeatAt: now.toISOString(), reason: input.reason ?? null,
      }).where(eq(computerLease.id, 'workspace')).returning()
      return this.changed(updated!, 'takeover', input.userName)
    })
  }

  async heartbeat(input: { userId: string }): Promise<ComputerLease> {
    return this.serialize(async () => {
      const row = await this.row()
      if (row.ownerKind !== 'human' || row.ownerId !== input.userId || this.expired(row)) throw new LeaseError('not_holder')
      const now = this.clock.now()
      const [updated] = await this.db.update(computerLease).set({
        expiresAt: new Date(now.getTime() + takeoverDurationMs()).toISOString(),
        heartbeatAt: now.toISOString(),
      }).where(eq(computerLease.id, 'workspace')).returning()
      return this.changed(updated!)
    })
  }

  async release(input: { userId: string; force?: boolean }): Promise<ComputerLease> {
    return this.serialize(async () => {
      const row = await this.row()
      if (row.ownerKind !== 'human' || (!input.force && row.ownerId !== input.userId)) throw new LeaseError('not_holder')
      return this.returnToBot(row, null)
    })
  }

  async sweepExpired(): Promise<ComputerLease | null> {
    return this.serialize(async () => {
      const row = await this.row()
      return this.expired(row) ? this.returnToBot(row, 'expired') : null
    })
  }

  private async returnToBot(previous: LeaseRow, reason: 'expired' | null): Promise<ComputerLease> {
    const [updated] = await this.db.update(computerLease).set({
      ownerKind: 'bot', ownerId: null, ownerName: null, epoch: previous.epoch + 1,
      acquiredAt: this.clock.now().toISOString(), expiresAt: null, heartbeatAt: null, reason,
    }).where(and(eq(computerLease.id, 'workspace'), eq(computerLease.epoch, previous.epoch))).returning()
    if (!updated) return publicLease(await this.row())
    return this.changed(updated, 'control_returned', previous.ownerName)
  }

  private async changed(row: LeaseRow, status?: 'takeover' | 'control_returned', by?: string | null): Promise<ComputerLease> {
    const lease = publicLease(row)
    const events: Array<{ roomId: string; event: TurnEvent }> = []
    if (status) {
      await this.db.transaction(async (transaction) => {
        const active = await transaction.select({ id: turns.id, roomId: turns.roomId }).from(turns).where(inArray(turns.status, ['running', 'waiting_approval']))
        for (const turn of active) {
          const seq = ((await transaction.select({ value: max(turnEvents.seq) }).from(turnEvents).where(eq(turnEvents.turnId, turn.id)))[0]?.value ?? 0) + 1
          const event: TurnEvent = {
            id: createId('event'), turnId: turn.id, seq, type: 'status',
            payload: { status, by: (by ?? null) as JsonValue }, createdAt: this.clock.now().toISOString(),
          }
          await transaction.insert(turnEvents).values(event)
          events.push({ roomId: turn.roomId, event })
        }
      })
    }
    console.info(`Computer lease changed: owner=${lease.ownerKind} epoch=${lease.epoch}`)
    this.hub.broadcastAll({ type: 'computer.lease', lease, ts: this.clock.now().toISOString() })
    for (const { roomId, event } of events) this.hub.broadcastRoom(roomId, { type: 'turn.event', roomId, turnId: event.turnId, event, ts: event.createdAt })
    await Promise.all([...this.listeners].map((listener) => listener(lease)))
    return lease
  }

  onChange(listener: (lease: ComputerLease) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async waitForBot(signal?: AbortSignal, timeoutMs = takeoverWaitMs()): Promise<void> {
    if (signal?.aborted) throw new Error('Waiting for bot control was aborted')
    let unsubscribe: () => void = () => undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => undefined
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        unsubscribe()
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve()
      }
      unsubscribe = this.onChange((lease) => { if (lease.ownerKind === 'bot') finish() })
      abort = () => finish(new Error('Waiting for bot control was aborted'))
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => finish(new Error(`Timed out waiting for bot control after ${timeoutMs} ms`)), timeoutMs)
      void this.current().then((lease) => { if (lease.ownerKind === 'bot') finish() }, (error) => finish(error instanceof Error ? error : new Error('Could not read the computer lease')))
    })
  }

  close(): void { clearInterval(this.sweepTimer); this.listeners.clear() }
}
