import { and, eq } from 'drizzle-orm'
import { createId } from '@openstaff/shared'
import { describe, expect, it, vi } from 'vitest'
import { automationInvocations, automationRuns, automations, bots, messages, roomMembers, rooms, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { AutomationService, type AutomationClock } from './service.js'

function fakeClock(value = '2026-09-12T12:00:00.000Z') {
  let now = new Date(value)
  const callbacks: Array<() => Promise<void>> = [], stops: ReturnType<typeof vi.fn>[] = []
  const clock: AutomationClock = { now: () => now, schedule: vi.fn((_cron, _timezone, tick) => { callbacks.push(tick); const stop = vi.fn(); stops.push(stop); return { stop } }) }
  return { clock, callbacks, stops, set: (next: string) => { now = new Date(next) } }
}

async function addBot(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const id = createId('bot'), now = new Date().toISOString()
  await f.db.insert(bots).values({ id, slug: name.toLowerCase(), name, job: 'Support', instructions: '', avatar: { shape: 'blob', color: '#EE46BC' }, approvalPolicy: 'auto', status: 'idle', createdBy: f.userId, createdAt: now })
  await f.db.insert(roomMembers).values({ roomId: f.roomId, memberKind: 'bot', memberId: id, joinedAt: now })
  return id
}

describe('AutomationService', () => {
  it('turns a schedule tick into one invocation, system message, and direct run per target', async () => {
    const f = await fixture(), time = fakeClock(), secondBotId = await addBot(f, 'Robin')
    const service = new AutomationService(f.db, f.admission, time.clock)
    try {
      const automation = await service.create({ name: 'Morning', trigger: 'schedule', cron: '* * * * *', prompt: 'Check status', roomId: f.roomId, targetBotIds: [secondBotId, f.botId] }, f.userId)
      expect(automation.nextRunAt).toBe('2026-09-12T12:01:00.000Z')
      await time.callbacks[0]!()
      expect(await f.db.select().from(messages)).toMatchObject([{ authorKind: 'system', text: 'Automation "Morning" (scheduled)\n\nCheck status' }])
      expect(await f.db.select().from(turns)).toMatchObject([{ botId: secondBotId, replyMode: 'direct' }, { botId: f.botId, replyMode: 'direct' }])
      expect(await f.db.select().from(automationInvocations)).toHaveLength(1)
      expect(await f.db.select().from(automationRuns)).toHaveLength(2)
    } finally { service.stop(); await f.close() }
  })

  it('isolates skip overlap per busy bot and queues all targets under queue overlap', async () => {
    const f = await fixture(), secondBotId = await addBot(f, 'Robin'), service = new AutomationService(f.db, f.admission, fakeClock().clock)
    try {
      await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Keep Drake busy' })
      const skipped = await service.create({ name: 'Split', trigger: 'schedule', cron: '* * * * *', prompt: 'Work', roomId: f.roomId, targetBotIds: [f.botId, secondBotId], overlap: 'skip' }, f.userId)
      const result = await service.fire({ automationId: skipped.id, source: 'manual', triggeredBy: f.userId })
      expect(result.outcome).toBe('fired')
      if (result.outcome !== 'fired') throw new Error('Expected fired')
      expect(result.invocation.runs.find((run) => run.botId === f.botId)).toMatchObject({ status: 'skipped', skipReason: 'busy', turnId: null })
      expect(result.invocation.runs.find((run) => run.botId === secondBotId)).toMatchObject({ status: 'queued' })
      const queued = await service.create({ name: 'Queue', trigger: 'schedule', cron: '* * * * *', prompt: 'More work', roomId: f.roomId, targetBotIds: [f.botId], overlap: 'queue' }, f.userId)
      const queueResult = await service.fire({ automationId: queued.id, source: 'manual', triggeredBy: f.userId })
      expect(queueResult.outcome).toBe('fired')
      expect((await f.db.select().from(turns).where(eq(turns.botId, f.botId))).length).toBe(2)
    } finally { service.stop(); await f.close() }
  })

  it('deduplicates a scheduled firing atomically and posts only one message', async () => {
    const f = await fixture(), service = new AutomationService(f.db, f.admission, fakeClock().clock)
    try {
      const automation = await service.create({ name: 'Once', trigger: 'schedule', cron: '* * * * *', prompt: 'Only once', roomId: f.roomId, targetBotIds: [f.botId], overlap: 'queue' }, f.userId)
      const scheduledAt = '2026-09-12T12:01:00.000Z'
      expect((await service.fire({ automationId: automation.id, source: 'schedule', scheduledAt })).outcome).toBe('fired')
      expect((await service.fire({ automationId: automation.id, source: 'schedule', scheduledAt })).outcome).toBe('deduplicated')
      expect(await f.db.select().from(messages)).toHaveLength(1)
      expect(await f.db.select().from(automationInvocations)).toHaveLength(1)
    } finally { service.stop(); await f.close() }
  })

  it('allows manual firing while paused', async () => {
    const f = await fixture(), service = new AutomationService(f.db, f.admission, fakeClock().clock)
    try {
      const automation = await service.create({ name: 'Paused', trigger: 'schedule', cron: '* * * * *', prompt: 'Run anyway', roomId: f.roomId, targetBotIds: [f.botId], enabled: false }, f.userId)
      expect((await service.fire({ automationId: automation.id, source: 'manual', triggeredBy: f.userId })).outcome).toBe('fired')
      expect(await f.db.select().from(messages)).toHaveLength(1)
    } finally { service.stop(); await f.close() }
  })

  it('auto-pauses after three failed invocations and enabling resets failure strikes', async () => {
    const f = await fixture(), time = fakeClock(), service = new AutomationService(f.db, f.admission, time.clock)
    try {
      const automation = await service.create({ name: 'Fragile', trigger: 'schedule', cron: '* * * * *', prompt: 'Fail', roomId: f.roomId, targetBotIds: [f.botId], overlap: 'queue' }, f.userId)
      for (let index = 0; index < 3; index++) {
        const result = await service.fire({ automationId: automation.id, source: 'manual', triggeredBy: f.userId })
        if (result.outcome !== 'fired') throw new Error('Expected fired')
        await f.db.update(turns).set({ status: 'failed', error: 'boom', finishedAt: time.clock.now().toISOString() }).where(eq(turns.id, result.invocation.runs[0]!.turnId!))
        await service.sweep()
      }
      expect(await service.get(automation.id)).toMatchObject({ enabled: false, pausedReason: 'failures', consecutiveFailures: 3, nextRunAt: null })
      expect((await f.db.select().from(messages)).at(-1)?.text).toBe('Automation "Fragile" paused after 3 failed runs. Resume it in room settings.')
      expect(time.stops.some((stop) => stop.mock.calls.length > 0)).toBe(true)
      expect(await service.update(automation.id, { enabled: true })).toMatchObject({ enabled: true, pausedReason: null, consecutiveFailures: 0 })
    } finally { service.stop(); await f.close() }
  })

  it('fires one missed run on start only when catch-up is enabled', async () => {
    const f = await fixture(), time = fakeClock(), service = new AutomationService(f.db, f.admission, time.clock)
    try {
      const yes = await service.create({ name: 'Catch up', trigger: 'schedule', cron: '* * * * *', prompt: 'Missed', roomId: f.roomId, targetBotIds: [f.botId], overlap: 'queue', catchUp: true }, f.userId)
      const no = await service.create({ name: 'No catch up', trigger: 'schedule', cron: '* * * * *', prompt: 'Skip missed', roomId: f.roomId, targetBotIds: [f.botId], overlap: 'queue', catchUp: false }, f.userId)
      service.stop()
      await f.db.update(automations).set({ nextRunAt: '2026-09-12T11:59:00.000Z' })
      await service.start()
      expect((await f.db.select().from(automationInvocations)).map((row) => row.automationId)).toEqual([yes.id])
      expect((await f.db.select().from(messages)).map((row) => row.text)).toEqual(['Automation "Catch up" (scheduled)\n\nMissed'])
      expect(await service.get(no.id)).toMatchObject({ enabled: true })
    } finally { service.stop(); await f.close() }
  })

  it('pauses with missing_member when no target remains and drops only missing targets otherwise', async () => {
    const f = await fixture(), secondBotId = await addBot(f, 'Robin'), service = new AutomationService(f.db, f.admission, fakeClock().clock)
    try {
      const partial = await service.create({ name: 'Partial', trigger: 'schedule', cron: '* * * * *', prompt: 'Work', roomId: f.roomId, targetBotIds: [f.botId, secondBotId] }, f.userId)
      await f.db.delete(roomMembers).where(and(eq(roomMembers.roomId, f.roomId), eq(roomMembers.memberId, secondBotId)))
      const fired = await service.fire({ automationId: partial.id, source: 'manual', triggeredBy: f.userId })
      if (fired.outcome !== 'fired') throw new Error('Expected fired')
      expect(fired.invocation.runs.map((run) => run.botId)).toEqual([f.botId])
      await f.db.delete(roomMembers).where(and(eq(roomMembers.roomId, f.roomId), eq(roomMembers.memberId, f.botId)))
      expect((await service.fire({ automationId: partial.id, source: 'manual', triggeredBy: f.userId })).outcome).toBe('disabled')
      expect(await service.get(partial.id)).toMatchObject({ enabled: false, pausedReason: 'missing_member' })
    } finally { service.stop(); await f.close() }
  })

  it('does not sweep an invocation that is still being admitted', async () => {
    const f = await fixture(), time = fakeClock(), service = new AutomationService(f.db, f.admission, time.clock)
    try {
      const automation = await service.create({ name: 'Racing', trigger: 'schedule', cron: '* * * * *', prompt: 'x', roomId: f.roomId, targetBotIds: [f.botId] }, f.userId)
      const id = createId('invocation')
      await f.db.insert(automationInvocations).values({ id, automationId: automation.id, source: 'manual', createdAt: time.clock.now().toISOString() })
      await service.sweep()
      expect((await f.db.select().from(automationInvocations).where(eq(automationInvocations.id, id)))[0]).toMatchObject({ failureCountedAt: null, completedAt: null })
      await f.db.update(automationInvocations).set({ skipReason: 'busy' }).where(eq(automationInvocations.id, id))
      await service.sweep()
      expect((await f.db.select().from(automationInvocations).where(eq(automationInvocations.id, id)))[0]?.failureCountedAt).toBe(time.clock.now().toISOString())
      expect(await service.get(automation.id)).toMatchObject({ consecutiveFailures: 0, enabled: true })
    } finally { service.stop(); await f.close() }
  })

  it('returns disabled after a room is deleted and rejects invalid cron', async () => {
    const f = await fixture(), service = new AutomationService(f.db, f.admission, fakeClock().clock)
    try {
      await expect(service.create({ name: 'Bad', trigger: 'schedule', cron: 'invalid', prompt: 'x', roomId: f.roomId, targetBotIds: [f.botId] }, f.userId)).rejects.toThrow()
      const automation = await service.create({ name: 'Orphan', trigger: 'schedule', cron: '* * * * *', prompt: 'x', roomId: f.roomId, targetBotIds: [f.botId] }, f.userId)
      await f.db.delete(rooms).where(eq(rooms.id, f.roomId))
      expect((await service.fire({ automationId: automation.id, source: 'manual', triggeredBy: f.userId })).outcome).toBe('disabled')
    } finally { service.stop(); await f.close() }
  })
})
