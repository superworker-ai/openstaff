import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Cron } from 'croner'
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import {
  AUTOMATION_FAILURE_LIMIT,
  automationInputSchema,
  automationSchema,
  createId,
  type Automation,
  type AutomationInput,
  type AutomationInvocation,
  type AutomationRun,
} from '@openstaff/shared'
import type { z } from 'zod'
import type { Database } from '../db/index.js'
import { automationInvocations, automationRuns, automations, bots, rooms, turns, users } from '../db/schema.js'
import type { RealtimeHub } from '../realtime/hub.js'
import type { AdmissionService } from '../rooms/admission.js'
import { deriveInvocationStatus } from './status.js'

export interface AutomationJob { stop(): void }
export interface AutomationClock {
  now(): Date
  schedule(cron: string, timezone: string, tick: () => Promise<void>): AutomationJob
}

const systemClock: AutomationClock = {
  now: () => new Date(),
  schedule: (cron, timezone, tick) => new Cron(cron, { timezone, protect: true, unref: true }, tick),
}

export function nextRun(cron: string, timezone: string, now: Date): string | null {
  if (cron.trim().split(/\s+/).length < 5) throw new Error('Use a cron expression with at least five fields')
  const check = new Cron(cron, { timezone, paused: true })
  try { return check.nextRun(now)?.toISOString() ?? null } finally { check.stop() }
}

class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    try { return await operation() } finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key) }
  }
}

type AutomationRow = typeof automations.$inferSelect
type InvocationRow = typeof automationInvocations.$inferSelect
export type AutomationCreateResult = Automation & { webhookKey?: string }
export type FireResult = { outcome: 'disabled' } | { outcome: 'deduplicated' } | { outcome: 'fired'; invocation: AutomationInvocation } | { outcome: 'skipped'; invocation: AutomationInvocation }

export class AutomationService {
  private readonly jobs = new Map<string, AutomationJob>()
  private readonly queue = new KeyedSerialQueue()
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private sweeping: Promise<void> | undefined

  constructor(private readonly db: Database, private readonly admission: AdmissionService, private readonly clock: AutomationClock = systemClock, private readonly hub?: RealtimeHub) {}

  async start(): Promise<void> {
    for (const automation of await this.db.select().from(automations).where(eq(automations.enabled, true))) {
      if (automation.trigger !== 'schedule') continue
      if (automation.catchUp && automation.nextRunAt && automation.nextRunAt < this.clock.now().toISOString()) {
        try { await this.fire({ automationId: automation.id, source: 'schedule', scheduledAt: automation.nextRunAt }) } catch (error) { console.warn(`Automation ${automation.id} catch-up failed`, error) }
      }
      const current = await this.row(automation.id)
      if (current?.enabled) await this.schedule(current)
    }
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => { void this.sweep().catch((error) => console.warn('Automation sweep failed', error)) }, 60_000)
      this.sweepTimer.unref()
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop()
    this.jobs.clear()
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = undefined
  }

  async create(input: z.input<typeof automationInputSchema>, createdBy: string): Promise<AutomationCreateResult> {
    const value = automationInputSchema.parse(input)
    await this.validateTargets(value.roomId, value.targetBotIds)
    const now = this.clock.now().toISOString()
    const nextRunAt = value.trigger === 'schedule' && value.enabled ? nextRun(value.cron!, value.timezone, this.clock.now()) : null
    const row: typeof automations.$inferInsert = {
      ...value,
      id: createId('automation'),
      pausedReason: value.enabled ? null : 'manual',
      consecutiveFailures: 0,
      webhookKeyHash: null,
      lastRunAt: null,
      nextRunAt,
      createdBy,
      createdAt: now,
      updatedAt: now,
    }
    await this.db.insert(automations).values(row)
    let webhookKey: string | undefined
    if (value.trigger === 'webhook') webhookKey = await this.createWebhookKey(row.id)
    else {
      if (value.enabled) await this.schedule(row as AutomationRow)
      this.broadcast(row as AutomationRow)
    }
    const created = await this.get(row.id)
    if (!created) throw new Error('Automation not found')
    return webhookKey ? { ...created, webhookKey } : created
  }

  async update(id: string, changes: Partial<AutomationInput>): Promise<Automation> {
    const current = await this.row(id)
    if (!current) throw new Error('Automation not found')
    if (changes.trigger !== undefined && changes.trigger !== current.trigger) throw new Error('Trigger cannot be changed')
    const value = automationInputSchema.parse({
      name: current.name, trigger: current.trigger, cron: current.cron, timezone: current.timezone, prompt: current.prompt,
      roomId: current.roomId, targetBotIds: current.targetBotIds, overlap: current.overlap, catchUp: current.catchUp, enabled: current.enabled, ...changes,
    })
    await this.validateTargets(value.roomId, value.targetBotIds)
    const nextRunAt = value.trigger === 'schedule' && value.enabled ? nextRun(value.cron!, value.timezone, this.clock.now()) : null
    const enabling = changes.enabled === true && !current.enabled
    const disabling = changes.enabled === false && current.enabled
    const updated = (await this.db.update(automations).set({
      ...value,
      nextRunAt,
      pausedReason: enabling ? null : disabling ? 'manual' : current.pausedReason,
      consecutiveFailures: enabling ? 0 : current.consecutiveFailures,
      updatedAt: this.clock.now().toISOString(),
    }).where(eq(automations.id, id)).returning())[0]!
    this.stopJob(id)
    if (updated.enabled && updated.trigger === 'schedule') await this.schedule(updated)
    this.broadcast(updated)
    return this.toPublic(updated)
  }

  async remove(id: string): Promise<void> {
    this.stopJob(id)
    await this.db.delete(automations).where(eq(automations.id, id))
  }

  async get(id: string): Promise<Automation | undefined> {
    const row = await this.row(id)
    return row ? this.toPublic(row) : undefined
  }

  async list(roomIds: string[]): Promise<Automation[]> {
    await this.sweep()
    if (!roomIds.length) return []
    return (await this.db.select().from(automations).where(inArray(automations.roomId, roomIds))).map((row) => this.toPublic(row))
  }

  async history(id: string, options: { limit: number; before?: string }): Promise<AutomationInvocation[]> {
    await this.sweep()
    const conditions = [eq(automationInvocations.automationId, id)]
    if (options.before) conditions.push(lt(automationInvocations.createdAt, options.before))
    const rows = await this.db.select().from(automationInvocations).where(and(...conditions)).orderBy(desc(automationInvocations.createdAt)).limit(options.limit)
    return Promise.all(rows.map((row) => this.hydrateInvocation(row)))
  }

  async createWebhookKey(id: string): Promise<string> {
    const current = await this.row(id)
    if (!current || current.trigger !== 'webhook') throw new Error('Automation is not a webhook')
    const key = randomBytes(32).toString('base64url')
    const updated = (await this.db.update(automations).set({ webhookKeyHash: this.hashKey(key), updatedAt: this.clock.now().toISOString() }).where(eq(automations.id, id)).returning())[0]!
    this.broadcast(updated)
    return key
  }

  async verifyWebhookKey(id: string, key: string): Promise<boolean> {
    const current = await this.row(id)
    if (!current || current.trigger !== 'webhook' || !current.webhookKeyHash) return false
    const expected = Buffer.from(current.webhookKeyHash, 'hex')
    const actual = Buffer.from(this.hashKey(key), 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  async fire(input: { automationId: string; source: 'schedule' | 'manual' | 'webhook'; scheduledAt?: string; triggerKey?: string; triggeredBy?: string; context?: string }): Promise<FireResult> {
    await this.sweep()
    return this.queue.run(input.automationId, async () => {
      let automation = await this.row(input.automationId)
      if (!automation || (!automation.enabled && input.source !== 'manual')) return { outcome: 'disabled' }
      const room = (await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, automation.roomId)).limit(1))[0]
      const memberBots = room ? await Promise.all(automation.targetBotIds.map(async (botId) => {
        if (!await this.admission.isMember(automation!.roomId, 'bot', botId)) return undefined
        return (await this.db.select({ id: bots.id, name: bots.name }).from(bots).where(eq(bots.id, botId)).limit(1))[0]
      })) : []
      const targets = memberBots.filter((bot): bot is { id: string; name: string } => Boolean(bot))
      if (!room || !targets.length) {
        automation = (await this.db.update(automations).set({ enabled: false, pausedReason: 'missing_member', nextRunAt: null, updatedAt: this.clock.now().toISOString() }).where(eq(automations.id, automation.id)).returning())[0]!
        this.stopJob(automation.id)
        if (room) {
          await this.admission.post({ roomId: automation.roomId, authorKind: 'system', authorId: null, text: `Automation "${automation.name}" paused: its bots are no longer in this room.`, planReplies: false })
        }
        this.broadcast(automation)
        return { outcome: 'disabled' }
      }
      if (input.source === 'schedule' && automation.cron) {
        const nextRunAt = nextRun(automation.cron, automation.timezone, this.clock.now())
        automation = (await this.db.update(automations).set({ nextRunAt, updatedAt: this.clock.now().toISOString() }).where(eq(automations.id, automation.id)).returning())[0]!
      }
      const createdAt = this.clock.now().toISOString()
      const invocation: typeof automationInvocations.$inferInsert = {
        id: createId('invocation'), automationId: automation.id, source: input.source, scheduledAt: input.scheduledAt ?? null,
        triggerKey: input.triggerKey ?? null, triggeredBy: input.triggeredBy ?? null, messageId: null, skipReason: null,
        failureCountedAt: null, createdAt, completedAt: null,
      }
      try { await this.db.insert(automationInvocations).values(invocation) } catch (error) {
        if (this.isUniqueConstraint(error)) return { outcome: 'deduplicated' }
        throw error
      }
      const busyIds = new Set<string>()
      if (automation.overlap === 'skip') {
        for (const target of targets) {
          const busy = (await this.db.select({ id: turns.id }).from(turns).where(and(eq(turns.botId, target.id), eq(turns.roomId, automation.roomId), inArray(turns.status, ['queued', 'running', 'waiting_approval']))).limit(1))[0]
          if (busy) busyIds.add(target.id)
        }
      }
      const startable = targets.filter((target) => !busyIds.has(target.id))
      if (startable.length) {
        const text = await this.messageText(automation, input)
        await this.admission.post({ roomId: automation.roomId, authorKind: 'system', authorId: null, actorUserId: await this.existingUser(automation.createdBy), text, automationBotIds: startable.map((target) => target.id), beforeEnqueue: async ({ message, turns: admittedTurns }) => {
          const lastRunAt = this.clock.now().toISOString()
          await this.db.transaction(async (transaction) => {
            await transaction.update(automationInvocations).set({ messageId: message.id }).where(eq(automationInvocations.id, invocation.id))
            await transaction.update(automations).set({ lastRunAt, updatedAt: lastRunAt }).where(eq(automations.id, automation!.id))
            await transaction.insert(automationRuns).values(targets.map((target) => ({
              id: createId('run'), invocationId: invocation.id, automationId: automation!.id, botId: target.id,
              turnId: admittedTurns.find((turn) => turn.botId === target.id)?.id ?? null,
              skipReason: busyIds.has(target.id) ? 'busy' : null, createdAt,
            })))
          })
        } })
      } else {
        await this.db.transaction(async (transaction) => {
          await transaction.update(automationInvocations).set({ skipReason: 'busy' }).where(eq(automationInvocations.id, invocation.id))
          await transaction.insert(automationRuns).values(targets.map((target) => ({ id: createId('run'), invocationId: invocation.id, automationId: automation!.id, botId: target.id, turnId: null, skipReason: 'busy', createdAt })))
        })
      }
      const persisted = (await this.db.select().from(automationInvocations).where(eq(automationInvocations.id, invocation.id)))[0]!
      return { outcome: startable.length ? 'fired' : 'skipped', invocation: await this.hydrateInvocation(persisted) }
    })
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping
    const operation = this.sweepPending()
    this.sweeping = operation
    try { await operation } finally { if (this.sweeping === operation) this.sweeping = undefined }
  }

  private async sweepPending(): Promise<void> {
    const pending = await this.db.select().from(automationInvocations).where(isNull(automationInvocations.failureCountedAt))
    for (const invocation of pending) {
      // Still being admitted: fire() sets messageId (fired) or skipReason (all busy) together with the runs.
      if (!invocation.messageId && !invocation.skipReason) continue
      const hydrated = await this.hydrateInvocation(invocation)
      if (hydrated.status === 'running') continue
      const finished = (await this.db.select({ finishedAt: turns.finishedAt }).from(automationRuns).leftJoin(turns, eq(turns.id, automationRuns.turnId)).where(eq(automationRuns.invocationId, invocation.id)))
        .map((row) => row.finishedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
      const countedAt = this.clock.now().toISOString()
      const claimed = await this.db.update(automationInvocations).set({ completedAt: finished ?? countedAt, failureCountedAt: countedAt })
        .where(and(eq(automationInvocations.id, invocation.id), isNull(automationInvocations.failureCountedAt))).returning()
      if (!claimed.length) continue
      const automation = await this.row(invocation.automationId)
      if (!automation) continue
      const consecutiveFailures = hydrated.status === 'failed' || hydrated.status === 'partial_failed'
        ? automation.consecutiveFailures + 1
        : hydrated.status === 'completed' ? 0 : automation.consecutiveFailures
      const autoPause = consecutiveFailures >= AUTOMATION_FAILURE_LIMIT && automation.enabled
      const updated = (await this.db.update(automations).set({
        consecutiveFailures,
        enabled: autoPause ? false : automation.enabled,
        pausedReason: autoPause ? 'failures' : automation.pausedReason,
        nextRunAt: autoPause ? null : automation.nextRunAt,
        updatedAt: countedAt,
      }).where(eq(automations.id, automation.id)).returning())[0]!
      if (autoPause) {
        this.stopJob(updated.id)
        await this.admission.post({ roomId: updated.roomId, authorKind: 'system', authorId: null, text: `Automation "${updated.name}" paused after 3 failed runs. Resume it in room settings.`, planReplies: false })
        this.broadcast(updated)
      }
    }
  }

  private async row(id: string): Promise<AutomationRow | undefined> {
    return (await this.db.select().from(automations).where(eq(automations.id, id)).limit(1))[0]
  }

  /** A scheduled turn acts for whoever created the automation, unless that member is gone. */
  private async existingUser(id: string): Promise<string | null> {
    return (await this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1))[0]?.id ?? null
  }

  private toPublic(row: AutomationRow): Automation {
    return automationSchema.parse({ ...row, hasWebhookKey: Boolean(row.webhookKeyHash) })
  }

  private async validateTargets(roomId: string, targetBotIds: string[]): Promise<void> {
    if (!await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).limit(1).then((rows) => rows[0])) throw new Error('Room not found')
    for (const botId of targetBotIds) if (!await this.admission.isMember(roomId, 'bot', botId)) throw new Error('Automation bots must be room members')
  }

  private async schedule(automation: AutomationRow): Promise<void> {
    this.stopJob(automation.id)
    if (automation.trigger !== 'schedule' || !automation.cron || !automation.enabled) return
    try {
      const nextRunAt = nextRun(automation.cron, automation.timezone, this.clock.now())
      const job = this.clock.schedule(automation.cron, automation.timezone, async () => {
        const current = await this.row(automation.id)
        if (!current) return
        try { await this.fire({ automationId: automation.id, source: 'schedule', scheduledAt: current.nextRunAt ?? this.clock.now().toISOString() }) }
        catch (error) { console.warn(`Automation ${automation.id} tick failed`, error) }
      })
      this.jobs.set(automation.id, job)
      await this.db.update(automations).set({ nextRunAt }).where(eq(automations.id, automation.id))
    } catch {
      const updated = (await this.db.update(automations).set({ enabled: false, pausedReason: 'invalid', nextRunAt: null, updatedAt: this.clock.now().toISOString() }).where(eq(automations.id, automation.id)).returning())[0]
      if (updated) this.broadcast(updated)
    }
  }

  private stopJob(id: string): void { this.jobs.get(id)?.stop(); this.jobs.delete(id) }

  private broadcast(row: AutomationRow): void {
    this.hub?.broadcastRoom(row.roomId, { type: 'automation.updated', roomId: row.roomId, automation: this.toPublic(row), ts: this.clock.now().toISOString() })
  }

  private async hydrateInvocation(invocation: InvocationRow): Promise<AutomationInvocation> {
    const rows = await this.db.select({ run: automationRuns, botName: bots.name, turnStatus: turns.status, error: turns.error })
      .from(automationRuns).leftJoin(bots, eq(bots.id, automationRuns.botId)).leftJoin(turns, eq(turns.id, automationRuns.turnId))
      .where(eq(automationRuns.invocationId, invocation.id))
    const runs: AutomationRun[] = rows.map(({ run, botName, turnStatus, error }) => ({
      id: run.id, invocationId: run.invocationId, botId: run.botId, botName: botName ?? run.botId, turnId: run.turnId,
      status: turnStatus ?? 'skipped', skipReason: run.skipReason, error: error ?? null,
    }))
    return { id: invocation.id, automationId: invocation.automationId, source: invocation.source, status: deriveInvocationStatus(runs), scheduledAt: invocation.scheduledAt, triggerKey: invocation.triggerKey, triggeredBy: invocation.triggeredBy, messageId: invocation.messageId, skipReason: invocation.skipReason, createdAt: invocation.createdAt, completedAt: invocation.completedAt, runs }
  }

  private async messageText(automation: AutomationRow, input: { source: 'schedule' | 'manual' | 'webhook'; triggeredBy?: string; context?: string }): Promise<string> {
    if (input.source === 'schedule') return `Automation "${automation.name}" (scheduled)\n\n${automation.prompt}`
    if (input.source === 'webhook') return `Automation "${automation.name}" (webhook)\n\n${automation.prompt}${input.context ? `\n\n${input.context}` : ''}`
    const user = input.triggeredBy ? (await this.db.select({ name: users.name }).from(users).where(eq(users.id, input.triggeredBy)).limit(1))[0] : undefined
    return `Automation "${automation.name}" (run by ${user?.name ?? input.triggeredBy ?? 'unknown user'})\n\n${automation.prompt}`
  }

  private hashKey(key: string): string { return createHash('sha256').update(key).digest('hex') }

  private isUniqueConstraint(error: unknown): boolean {
    let current: unknown = error
    while (current) {
      const text = current instanceof Error ? `${current.name} ${current.message} ${(current as Error & { code?: string }).code ?? ''}` : String(current)
      if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(text)) return true
      current = current instanceof Error ? current.cause : undefined
    }
    return false
  }
}
