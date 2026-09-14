import { and, eq, inArray, lte } from 'drizzle-orm'
import { APPROVAL_TTL_MS } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { approvals, bots, turns } from '../db/schema.js'
import { publicTurn } from '../db/public.js'
import { AdmissionService } from '../rooms/admission.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { serializeApprovals } from './approval-lock.js'

export async function expireApprovals(db: Database, hub?: RealtimeHub, now = Date.now(), admission = new AdmissionService(db, hub)): Promise<void> {
  const ts = new Date(now).toISOString()
  const result = await serializeApprovals(db, () => db.transaction(async (transaction) => {
    const overdue = await transaction.select({ turnId: approvals.turnId }).from(approvals)
      .where(and(eq(approvals.status, 'pending'), lte(approvals.createdAt, new Date(now - APPROVAL_TTL_MS).toISOString())))
    const ids = [...new Set(overdue.map((item) => item.turnId))]
    if (!ids.length) return { expired: [], failed: [] }
    const expired = await transaction.update(approvals).set({ status: 'expired', decidedAt: ts })
      .where(and(eq(approvals.status, 'pending'), inArray(approvals.turnId, ids))).returning()
    const failed = await transaction.update(turns).set({ status: 'failed', finishedAt: ts, error: 'Tool approval expired after 24 hours' })
      .where(and(inArray(turns.id, ids), eq(turns.status, 'waiting_approval'))).returning()
    for (const turn of failed) await transaction.update(bots).set({ status: 'idle' }).where(eq(bots.id, turn.botId))
    return { expired, failed }
  }))
  for (const approval of result.expired) hub?.broadcastRoom(approval.roomId, { type: 'approval.updated', approval, ts })
  for (const turn of result.failed) {
    hub?.broadcastRoom(turn.roomId, { type: 'turn.updated', turn: publicTurn(turn), ts })
    const bot = (await db.select().from(bots).where(eq(bots.id, turn.botId)))[0]
    await admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: `${bot?.name ?? 'Bot'} couldn't reply: tool approval expired after 24 hours`, planReplies: false })
  }
}
