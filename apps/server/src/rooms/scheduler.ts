import { and, asc, eq, inArray } from 'drizzle-orm'
import { type JsonValue, type Turn } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { bots, messages, roomMembers, rooms, turns } from '../db/schema.js'
import { expireApprovals } from '../agent/approval-expiry.js'
import type { RealtimeHub } from '../realtime/hub.js'
import type { RoomCompactor } from '../agent/compaction.js'
import type { AgentRuntime } from '../agent/runtime.js'
import { MissingApiKeyError } from '../agent/models.js'
import type { AdmissionService } from './admission.js'
import { planTurns } from './planner.js'
import { publicTurn } from '../db/public.js'

export class TurnScheduler {
  private readonly pending: Turn[] = []
  private readonly activeRooms = new Set<string>()
  private readonly activeBots = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()
  private pumping = false
  private stopping = false
  private readonly executions = new Set<Promise<void>>()

  constructor(
    private readonly db: Database,
    private readonly runtime: AgentRuntime,
    private readonly admission: AdmissionService,
    private readonly hub: RealtimeHub | undefined,
    private readonly maxConcurrentTurns: number,
    private readonly compactor?: RoomCompactor,
  ) {}

  enqueue(newTurns: Turn[]): void {
    if (this.stopping) return
    for (const turn of newTurns) {
      if (!this.pending.some((item) => item.id === turn.id) && !this.controllers.has(turn.id)) this.pending.push(turn)
    }
    this.pump()
  }

  private pump(): void {
    if (this.pumping || this.stopping) return
    this.pumping = true
    queueMicrotask(() => {
      try {
        while (!this.stopping && this.controllers.size < this.maxConcurrentTurns) {
          const index = this.pending.findIndex((turn, turnIndex) => {
            const firstForRoom = this.pending.findIndex((candidate) => candidate.roomId === turn.roomId) === turnIndex
            return firstForRoom && !this.activeRooms.has(turn.roomId) && !this.activeBots.has(turn.botId)
          })
          if (index < 0) break
          const [turn] = this.pending.splice(index, 1)
          if (!turn) break
          this.start(turn)
        }
      } finally {
        this.pumping = false
      }
    })
  }

  private start(turn: Turn): void {
    const controller = new AbortController()
    this.controllers.set(turn.id, controller)
    this.activeRooms.add(turn.roomId)
    this.activeBots.add(turn.botId)
    const execution = this.execute(turn, controller.signal).catch((error) => console.warn('Turn execution failed', error)).finally(() => {
      this.controllers.delete(turn.id)
      this.activeRooms.delete(turn.roomId)
      this.activeBots.delete(turn.botId)
      this.executions.delete(execution)
      this.pump()
    })
    this.executions.add(execution)
  }

  private async execute(turn: Turn, signal: AbortSignal): Promise<void> {
    const current = (await this.db.select().from(turns).where(eq(turns.id, turn.id)).limit(1))[0]
    if (!current || current.status !== 'queued') return
    if (turn.replyMode === 'optional' && !current.modelMessages.length) {
      const trigger = (await this.db.select({ authorKind: messages.authorKind }).from(messages).where(eq(messages.id, turn.triggerMessageId)).limit(1))[0]
      const triggerTurns = await this.db.select({ id: turns.id, status: turns.status, error: turns.error }).from(turns).where(eq(turns.triggerMessageId, turn.triggerMessageId))
      const otherTurns = triggerTurns.filter((candidate) => candidate.id !== turn.id)
      const unresolvedTurns = triggerTurns.filter((candidate) => !['done', 'skipped', 'failed', 'cancelled'].includes(candidate.status))
      const designatedFallback = trigger?.authorKind === 'user' && otherTurns.every((candidate) => candidate.status === 'skipped' && candidate.error === null) && unresolvedTurns.length === 1 && unresolvedTurns[0]?.id === turn.id
      try {
        if (!designatedFallback && !await this.runtime.decideReply(turn, signal)) {
          await this.finish(turn, 'skipped')
          return
        }
      } catch (error) {
        if (signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof MissingApiKeyError) {
          const notes = await this.db.select().from(messages).where(and(eq(messages.roomId, turn.roomId), eq(messages.authorKind, 'system')))
          if (!notes.some((note) => note.attachments.some((item) => item.subtype === 'decision-error' && item.triggerMessageId === turn.triggerMessageId))) {
            const bot = (await this.db.select().from(bots).where(eq(bots.id, turn.botId)))[0]
            await this.admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: `${bot?.name ?? 'Bot'} couldn't reply: ${error.message}`, attachments: [{ subtype: 'decision-error', triggerMessageId: turn.triggerMessageId }], planReplies: false })
          }
        }
        await this.finish(turn, 'skipped', { error: message })
        return
      }
    }
    if (signal.aborted) return
    const startedAt = new Date().toISOString(), computerProvider = await this.runtime.computerProvider()
    await this.db.transaction(async (transaction) => {
      await transaction.update(turns).set({ status: 'running', startedAt, computerProvider: computerProvider ?? null }).where(eq(turns.id, turn.id))
      await transaction.update(bots).set({ status: 'working' }).where(eq(bots.id, turn.botId))
    })
    this.broadcastTurn({ ...turn, status: 'running', startedAt })
    this.runtime.computerTurnStarted()
    try {
      const result = await this.runtime.run({ ...turn, status: 'running', startedAt }, signal)
      if (signal.aborted) return
      if (result.kind === 'waiting') {
        const waiting = (await this.db.select().from(turns).where(eq(turns.id, turn.id)).limit(1))[0]
        if (waiting) this.broadcastTurn(waiting as Turn)
        return
      }
      if (result.kind === 'skipped') {
        await this.finish(turn, 'skipped')
        return
      }
      await this.admission.post({ roomId: turn.roomId, authorKind: 'bot', authorId: turn.botId, text: result.text, turnId: turn.id, handoffDepth: turn.handoffDepth })
      await this.finish(turn, 'done', { usage: result.usage })
    } catch (error) {
      if (signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      await this.finish(turn, 'failed', { error: message })
      const bot = (await this.db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1))[0]
      const reason = error instanceof MissingApiKeyError ? error.message : message
      await this.admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: `${bot?.name ?? 'Bot'} couldn't reply: ${reason}`, planReplies: false })
    } finally { this.runtime.computerTurnFinished() }
  }

  private async finish(turn: Turn, status: 'done' | 'skipped' | 'failed' | 'cancelled', values: { usage?: Record<string, JsonValue>; error?: string } = {}): Promise<void> {
    const finishedAt = new Date().toISOString()
    await this.db.transaction(async (transaction) => {
      await transaction.update(turns).set({ status, finishedAt, ...values }).where(eq(turns.id, turn.id))
      await transaction.update(bots).set({ status: 'idle' }).where(eq(bots.id, turn.botId))
    })
    if (status === 'done') this.compactor?.schedule(turn.roomId)
    this.broadcastTurn({ ...turn, status, finishedAt, usage: values.usage ?? turn.usage, error: values.error ?? turn.error })
  }

  private broadcastTurn(turn: Turn): void {
    this.hub?.broadcastRoom(turn.roomId, { type: 'turn.updated', turn: publicTurn(turn), ts: new Date().toISOString() })
  }

  async cancel(turnId: string): Promise<boolean> {
    const pendingIndex = this.pending.findIndex((turn) => turn.id === turnId)
    const active = this.controllers.get(turnId)
    const turn = pendingIndex >= 0 ? this.pending.splice(pendingIndex, 1)[0] : (await this.db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0]
    if (!turn || !['queued', 'running', 'waiting_approval'].includes(turn.status)) return false
    const finishedAt = new Date().toISOString()
    const changed = await this.db.update(turns).set({ status: 'cancelled', finishedAt }).where(and(eq(turns.id, turnId), inArray(turns.status, ['queued', 'running', 'waiting_approval']))).returning()
    if (!changed.length) return false
    active?.abort('Cancelled')
    await this.db.update(bots).set({ status: 'idle' }).where(eq(bots.id, turn.botId))
    this.broadcastTurn(changed[0]! as Turn)
    const bot = (await this.db.select().from(bots).where(eq(bots.id, turn.botId)))[0]
    await this.admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: `${bot?.name ?? 'Bot'} was stopped`, planReplies: false })
    return true
  }

  async recover(): Promise<void> {
    const running = await this.db.select().from(turns).where(eq(turns.status, 'running'))
    for (const turn of running) {
      await this.finish(turn as Turn, 'failed', { error: 'Server restarted while this turn was running' })
      const bot = (await this.db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1))[0]
      await this.admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: `${bot?.name ?? 'Bot'} couldn't reply: server restarted during the turn`, planReplies: false })
    }
    await expireApprovals(this.db, this.hub, Date.now(), this.admission)
    const queued = await this.db.select({ turn: turns, trigger: messages, room: rooms }).from(turns)
      .innerJoin(messages, eq(messages.id, turns.triggerMessageId))
      .innerJoin(rooms, eq(rooms.id, turns.roomId))
      .where(inArray(turns.status, ['queued']))
      .orderBy(asc(turns.roomId), asc(messages.seq))
    const ordered: Turn[] = []
    for (let index = 0; index < queued.length;) {
      const triggerId = queued[index]!.turn.triggerMessageId
      const group = queued.filter((row) => row.turn.triggerMessageId === triggerId)
      const memberRows = await this.db.select({ id: roomMembers.memberId }).from(roomMembers)
        .where(and(eq(roomMembers.roomId, group[0]!.turn.roomId), eq(roomMembers.memberKind, 'bot')))
        .orderBy(asc(roomMembers.joinedAt))
      const plans = planTurns({
        roomKind: group[0]!.room.kind,
        authorKind: group[0]!.trigger.authorKind,
        botMembers: memberRows,
        mentions: group[0]!.trigger.mentions,
        handoffDepth: Math.max(0, group[0]!.turn.handoffDepth - (group[0]!.trigger.authorKind === 'bot' ? 1 : 0)),
      })
      group.sort((left, right) => plans.findIndex((plan) => plan.botId === left.turn.botId) - plans.findIndex((plan) => plan.botId === right.turn.botId))
      ordered.push(...group.map((row) => row.turn as Turn))
      index += group.length
    }
    this.enqueue(ordered)
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    for (const controller of this.controllers.values()) controller.abort('Server shutdown')
    await Promise.allSettled(this.executions)
  }
}
