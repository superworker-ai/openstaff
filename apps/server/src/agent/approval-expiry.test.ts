import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { createId } from '@openstaff/shared'
import { fixture } from '../test/fixture.js'
import { approvals, bots, messages, turns } from '../db/schema.js'
import { expireApprovals } from './approval-expiry.js'

it('expires the whole pending batch when its oldest approval reaches 24 hours and fails the turn once', async () => {
  const f = await fixture()
  try {
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'hello' })
    const turn = (await f.db.select().from(turns))[0]!
    await f.db.update(turns).set({ status: 'waiting_approval', startedAt: '2026-01-01T00:00:00.000Z' }).where(eq(turns.id, turn.id))
    const base = { turnId: turn.id, roomId: f.roomId, botId: f.botId, toolName: 'shell', input: {}, summary: 'Run command', status: 'pending' as const }
    const recent = createId('approval'), old = createId('approval')
    await f.db.insert(approvals).values([
      { ...base, id: recent, approvalId: 'recent', createdAt: '2026-09-12T11:00:00.000Z' },
      { ...base, id: old, approvalId: 'old', createdAt: '2026-09-11T12:00:00.000Z' },
    ])
    await expireApprovals(f.db, undefined, Date.parse('2026-09-12T11:59:59.000Z'))
    expect((await f.db.select().from(approvals)).every((row) => row.status === 'pending')).toBe(true)
    await expireApprovals(f.db, undefined, Date.parse('2026-09-12T12:00:00.000Z'))
    expect((await f.db.select().from(approvals).where(eq(approvals.id, recent)))[0]?.status).toBe('expired')
    expect((await f.db.select().from(approvals).where(eq(approvals.id, old)))[0]?.status).toBe('expired')
    expect((await f.db.select().from(turns))[0]).toMatchObject({ status: 'failed', error: 'Tool approval expired after 24 hours' })
    expect((await f.db.select().from(bots))[0]?.status).toBe('idle')
    await expireApprovals(f.db, undefined, Date.parse('2026-09-13T12:00:00.000Z'))
    expect((await f.db.select().from(messages)).filter((message) => message.authorKind === 'system').map((message) => message.text)).toEqual(["drake couldn't reply: tool approval expired after 24 hours"])
  } finally { await f.close() }
})
