import { expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { createId } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { fixture } from '../test/fixture.js'
import { objectResult, textStream } from '../test/mock-model.js'
import { bots, messages, roomMembers, rooms, turns } from '../db/schema.js'
import { AgentRuntime } from '../agent/runtime.js'
import { MissingApiKeyError } from '../agent/models.js'
import { TurnScheduler } from './scheduler.js'

it('stores handoff provenance and never schedules from a bot free-text mention', async () => {
  const f = await fixture()
  try {
    const free = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@drake handles this' })
    expect(free.turns).toEqual([])
    const handoff = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@drake act', explicitMentions: [{ kind: 'bot', id: f.botId, handoff: true }] })
    expect(handoff.message.mentions).toEqual([{ kind: 'bot', id: f.botId, handoff: true }])
    expect(handoff.turns).toHaveLength(1)
    expect(handoff.turns[0]?.handoffDepth).toBe(1)
  } finally { await f.close() }
})

it('posts one missing-key notice per optional trigger across bots', async () => {
  const f = await fixture()
  try {
    const second = createId('bot'), original = (await f.db.select().from(bots))[0]!
    await f.db.insert(bots).values({ ...original, id: second, slug: 'john', name: 'john' })
    await f.db.insert(roomMembers).values({ roomId: f.roomId, memberId: second, memberKind: 'bot', joinedAt: new Date().toISOString() })
    await f.db.update(rooms).set({ kind: 'group' }).where(eq(rooms.id, f.roomId))
    const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => { throw new MissingApiKeyError('xai') } })
    const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'hello' })
    await vi.waitFor(async () => { expect((await f.db.select().from(turns)).map((turn) => turn.status)).toEqual(['skipped', 'skipped']) })
    expect((await f.db.select().from(messages)).filter((message) => message.authorKind === 'system')).toHaveLength(1)
  } finally { await f.close() }
})

it('the last declining bot in a group replies anyway to a human message', async () => {
  const f = await fixture()
  try {
    const second = createId('bot'), original = (await f.db.select().from(bots))[0]!
    await f.db.insert(bots).values({ ...original, id: second, slug: 'john', name: 'john' })
    await f.db.insert(roomMembers).values({ roomId: f.roomId, memberId: second, memberKind: 'bot', joinedAt: new Date().toISOString() })
    await f.db.update(rooms).set({ kind: 'group' }).where(eq(rooms.id, f.roomId))
    const model = new MockLanguageModelV3({ doGenerate: objectResult({ reply: false, reason: 'no' }), doStream: textStream('Fallback reply.') })
    const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => model })
    const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'hello' })
    await vi.waitFor(async () => {
      const stored = await f.db.select().from(turns)
      expect(posted.turns.map((planned) => stored.find((turn) => turn.id === planned.id)?.status)).toEqual(['skipped', 'done'])
    })
    expect((await f.db.select().from(messages)).filter((message) => message.authorKind === 'bot')).toEqual([expect.objectContaining({ text: 'Fallback reply.' })])
  } finally { await f.close() }
})

it('records reply-decision errors on skipped turns', async () => {
  const f = await fixture()
  try {
    const second = createId('bot'), original = (await f.db.select().from(bots))[0]!
    await f.db.insert(bots).values({ ...original, id: second, slug: 'john', name: 'john' })
    await f.db.insert(roomMembers).values({ roomId: f.roomId, memberId: second, memberKind: 'bot', joinedAt: new Date().toISOString() })
    await f.db.update(rooms).set({ kind: 'group' }).where(eq(rooms.id, f.roomId))
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('boom') } })
    const runtime = new AgentRuntime({ ...f, contextMessages: 10, modelResolver: () => model })
    const scheduler = new TurnScheduler(f.db, runtime, f.admission, undefined, 3)
    f.admission.setTurnEnqueuer((values) => scheduler.enqueue(values))
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'hello' })
    await vi.waitFor(async () => { expect((await f.db.select().from(turns)).map((turn) => ({ status: turn.status, error: turn.error }))).toEqual([{ status: 'skipped', error: 'boom' }, { status: 'skipped', error: 'boom' }]) })
  } finally { await f.close() }
})
