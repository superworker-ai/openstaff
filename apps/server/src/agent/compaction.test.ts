import { expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { fixture } from '../test/fixture.js'
import { objectResult } from '../test/mock-model.js'
import { RoomCompactor } from './compaction.js'
import { roomSummaries } from '../db/schema.js'
import { loadRoomHistory } from './history.js'

it('compacts incrementally with labeled history, throttled to 20 new messages', async () => {
  const f = await fixture()
  let calls = 0
  const model = new MockLanguageModelV3({ doGenerate: async (options) => {
    calls++
    const prompt = JSON.stringify(options.prompt)
    expect(prompt).toContain('[Juan]')
    if (calls === 2) expect(prompt).toContain('Earlier decision')
    return { ...objectResult({}), content: [{ type: 'text' as const, text: 'Earlier decision: ship the feature.' }] }
  } })
  const compactor = new RoomCompactor(f.db, () => model, 20)
  const post = () => f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Ship it', planReplies: false })
  try {
    for (let i = 0; i < 22; i++) await post()
    await compactor.compact(f.roomId)
    expect((await f.db.select().from(roomSummaries))[0]?.upToSeq).toBe(11)
    expect(await loadRoomHistory(f.db, f.roomId, 20)).toContain('Earlier in this room: Earlier decision')
    for (let i = 0; i < 19; i++) await post()
    await compactor.compact(f.roomId); expect(calls).toBe(1)
    await post(); await compactor.compact(f.roomId); expect(calls).toBe(2)
    expect((await f.db.select().from(roomSummaries))[0]?.upToSeq).toBeGreaterThan(11)
  } finally { await compactor.close(); await f.close() }
})
