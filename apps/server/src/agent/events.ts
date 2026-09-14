import { eq, max, sql } from 'drizzle-orm'
import { createId, MAX_TURN_EVENTS, type JsonValue, type TurnEvent } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { turnEvents } from '../db/schema.js'
import type { RealtimeHub } from '../realtime/hub.js'

export class TurnEventRecorder {
  private written = 0
  private baseline: number | undefined
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub | undefined,
    private readonly turnId: string,
    private readonly roomId: string,
  ) {}

  record(type: TurnEvent['type'], payload: Record<string, JsonValue>): Promise<TurnEvent | null> {
    const result = this.tail.then(() => this.write(type, payload))
    this.tail = result.catch(() => undefined)
    return result
  }

  private async write(type: TurnEvent['type'], payload: Record<string, JsonValue>): Promise<TurnEvent | null> {
    // The cap is a safety valve, so a best-effort estimate is enough here.
    this.baseline ??= (await this.db.select({ value: max(turnEvents.seq) }).from(turnEvents).where(eq(turnEvents.turnId, this.turnId)))[0]?.value ?? 0
    if (this.baseline + this.written + 1 > MAX_TURN_EVENTS) return null
    const draft = { id: createId('event'), turnId: this.turnId, type, payload, createdAt: new Date().toISOString() }
    // Other writers (computer takeover, approval decisions) append to the same turn from their own
    // transactions, so the sequence must be allocated by the database in the insert itself, never
    // from a counter cached in this process.
    const [row] = await this.db.insert(turnEvents)
      .values({ ...draft, seq: sql`(select coalesce(max(${turnEvents.seq}), 0) + 1 from ${turnEvents} where ${turnEvents.turnId} = ${this.turnId})` })
      .returning({ seq: turnEvents.seq })
    this.written += 1
    const event: TurnEvent = { ...draft, seq: row!.seq }
    this.hub?.broadcastRoom(this.roomId, {
      type: 'turn.event', turnId: this.turnId, roomId: this.roomId, event, ts: event.createdAt,
    })
    return event
  }
}
