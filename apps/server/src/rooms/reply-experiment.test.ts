import { expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { createId } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { fixture } from '../test/fixture.js'
import { objectResult, textStream } from '../test/mock-model.js'
import { bots, messages, roomMembers, rooms, turns } from '../db/schema.js'
import { AgentRuntime } from '../agent/runtime.js'
import { ReplyDecisionExperiment, type DecisionService, type ReplyEvaluation, type ReplyObserver } from '../agent/reply-decision.js'
import { TurnScheduler } from './scheduler.js'

const evaluation: ReplyEvaluation = { model: 'jev-test', probabilities: { relevant: 0.99, actionable: 0.99, covered: 0.01, new_information: 0.01 }, usage: { input_tokens: 100, output_tokens: 40 } }

async function groupFixture() {
  const f = await fixture()
  const second = createId('bot'), original = (await f.db.select().from(bots))[0]!
  await f.db.insert(bots).values({ ...original, id: second, slug: 'bella', name: 'Bella', job: 'Designer' })
  await f.db.insert(roomMembers).values({ roomId: f.roomId, memberId: second, memberKind: 'bot', joinedAt: new Date(Date.now() + 1).toISOString() })
  await f.db.update(rooms).set({ kind: 'group' }).where(eq(rooms.id, f.roomId))
  return { ...f, second }
}

it('compares sequential optional bots against fresh teammate replies without changing turns', async () => {
  const f = await groupFixture(), evaluate = vi.fn<DecisionService['evaluate']>(async () => evaluation)
  const record = vi.fn<ReplyObserver>()
  const experiment = new ReplyDecisionExperiment({ evaluate }, { record })
  let decisions = 0
  const model = new MockLanguageModelV3({
    doGenerate: async () => objectResult({ reply: decisions++ === 0, reason: 'Synthetic baseline' }),
    doStream: async () => textStream('Restored DATABASE_URL and verified recovery.'),
  })
  const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => model, replyDecisionExperiment: experiment })
  const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
  try {
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Investigate the API outage.' })
    await vi.waitFor(async () => {
      const stored = await f.db.select().from(turns)
      expect(posted.turns.map((planned) => stored.find((turn) => turn.id === planned.id)?.status)).toEqual(['done', 'skipped'])
    })
    await experiment.drain()
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[0]?.[0]).toMatchObject({ recentReplies: '(None yet.)' })
    expect(evaluate.mock.calls[1]?.[0]).toMatchObject({ recentReplies: expect.stringContaining('Restored DATABASE_URL') })
    expect(evaluate.mock.calls[1]?.[0]).toMatchObject({ trigger: { authorKind: 'user', text: 'Investigate the API outage.' } })
    const comparisons = record.mock.calls.map(([context, observation]) => ({ context, observation }))
    expect(comparisons).toHaveLength(2)
    expect(comparisons.map((event) => event.observation.agrees)).toEqual([true, false])
    expect(comparisons[0]?.context).toMatchObject({ roomId: f.roomId, turnId: posted.turns[0]?.id })
    expect((await f.db.select().from(messages)).filter((message) => message.authorKind === 'bot')).toHaveLength(1)
    expect(await f.db.select().from(turns)).toHaveLength(2)
  } finally { await scheduler.shutdown(); await experiment.close(); await f.close() }
})

it('preserves the final responder fallback and does not classify that forced reply', async () => {
  const f = await groupFixture(), evaluate = vi.fn(async () => evaluation)
  const experiment = new ReplyDecisionExperiment({ evaluate })
  const model = new MockLanguageModelV3({ doGenerate: objectResult({ reply: false, reason: 'No contribution' }), doStream: async () => textStream('How can we help?') })
  const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => model, replyDecisionExperiment: experiment })
  const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
  try {
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Hello team.' })
    await vi.waitFor(async () => {
      const stored = await f.db.select().from(turns)
      expect(posted.turns.map((planned) => stored.find((turn) => turn.id === planned.id)?.status)).toEqual(['skipped', 'done'])
    })
    await experiment.drain()
    expect(evaluate).toHaveBeenCalledTimes(1)
  } finally { await scheduler.shutdown(); await experiment.close(); await f.close() }
})

it('leaves explicit bot handoffs direct and ordinary bot messages silent', async () => {
  const f = await groupFixture(), evaluate = vi.fn(async () => evaluation)
  const experiment = new ReplyDecisionExperiment({ evaluate })
  const model = new MockLanguageModelV3({ doStream: async () => textStream('The design review is complete.') })
  const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => model, replyDecisionExperiment: experiment })
  const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
  try {
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    const mentioned = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@Bella could help.' })
    expect(mentioned.turns).toEqual([])
    const handed = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@Bella please review the design.', explicitMentions: [{ kind: 'bot', id: f.second, handoff: true }] })
    expect(handed.turns).toHaveLength(1)
    expect(handed.turns[0]).toMatchObject({ replyMode: 'direct', handoffDepth: 1 })
    await vi.waitFor(async () => expect((await f.db.select().from(turns))[0]?.status).toBe('done'))
    expect(evaluate).not.toHaveBeenCalled()
    const capped = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@Bella continue.', handoffDepth: 3, explicitMentions: [{ kind: 'bot', id: f.second, handoff: true }] })
    expect(capped.turns).toEqual([])
  } finally { await scheduler.shutdown(); await experiment.close(); await f.close() }
})
