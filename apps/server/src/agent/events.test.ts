import { eq, max } from 'drizzle-orm'
import { createId } from '@openstaff/shared'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { messages, turnEvents, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { TurnEventRecorder } from './events.js'

let f: Awaited<ReturnType<typeof fixture>>
let turnId: string

beforeEach(async () => {
  f = await fixture()
  const messageId = createId('message'); turnId = createId('turn')
  await f.db.insert(messages).values({ id: messageId, roomId: f.roomId, seq: 1, authorKind: 'user', authorId: f.userId, text: 'go', mentions: [], attachments: [], createdAt: new Date().toISOString() })
  await f.db.insert(turns).values({ id: turnId, roomId: f.roomId, botId: f.botId, triggerMessageId: messageId, status: 'running', replyMode: 'direct', model: 'xai/test', modelMessages: [] })
})
afterEach(async () => { await f.close() })

/** Mimics the takeover and approval writers: max+1 computed in their own statement. */
async function externalWrite(status: string) {
  const seq = ((await f.db.select({ value: max(turnEvents.seq) }).from(turnEvents).where(eq(turnEvents.turnId, turnId)))[0]?.value ?? 0) + 1
  await f.db.insert(turnEvents).values({ id: createId('event'), turnId, seq, type: 'status', payload: { status }, createdAt: new Date().toISOString() })
  return seq
}

it('keeps recording after another writer appended to the same turn', async () => {
  const recorder = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
  expect((await recorder.record('status', { tools: 3 }))?.seq).toBe(1)
  expect((await recorder.record('tool-call', { toolName: 'shell', toolCallId: 'c1', input: {} }))?.seq).toBe(2)
  expect(await externalWrite('takeover')).toBe(3)
  const next = await recorder.record('tool-result', { toolName: 'shell', toolCallId: 'c1', output: 'ok' })
  expect(next?.seq).toBe(4)
  const rows = await f.db.select({ seq: turnEvents.seq, type: turnEvents.type }).from(turnEvents).where(eq(turnEvents.turnId, turnId)).orderBy(turnEvents.seq)
  expect(rows.map((row) => `${row.seq}:${row.type}`)).toEqual(['1:status', '2:tool-call', '3:status', '4:tool-result'])
})

it('two recorders on one turn never collide', async () => {
  const a = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
  const b = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? a : b).record('status', { index })))
  const seqs = results.map((event) => event!.seq).sort((x, y) => x - y)
  expect(seqs).toEqual(Array.from({ length: 10 }, (_, index) => index + 1))
})
