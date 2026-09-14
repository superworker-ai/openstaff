import { and, asc, eq, max, sql } from 'drizzle-orm'
import type { ModelMessage, ToolApprovalResponse } from 'ai'
import { createId, type JsonValue, type Turn, type TurnEvent } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { approvals, bots, turnEvents, turns } from '../db/schema.js'
import type { AdmissionService } from '../rooms/admission.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { expireApprovals } from './approval-expiry.js'
import { serializeApprovals } from './approval-lock.js'

export const HUMAN_COMPLETED_TOOL_RESULT = 'A human completed this step on the computer. Take a fresh browser_snapshot and continue.'

export async function appendApprovalResponse(db: Database, approvalId: string, decision: boolean | 'human_completed', reason?: string, options: { decidedBy?: string; hub?: RealtimeHub; admission?: AdmissionService } = {}): Promise<Turn | null> {
  await expireApprovals(db, options.hub, Date.now(), options.admission)
  const approved = decision === true
  const responseReason = decision === 'human_completed' ? HUMAN_COMPLETED_TOOL_RESULT : reason
  let decisionEvent: TurnEvent | undefined
  const updatedTurn = await serializeApprovals(db, () => db.transaction(async (transaction) => {
    const approval = (await transaction.select().from(approvals).where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending'))))[0]
    if (!approval) return null
    const turn = (await transaction.select().from(turns).where(eq(turns.id, approval.turnId)))[0]
    if (!turn || turn.status !== 'waiting_approval') return null
    const now = new Date().toISOString()
    await transaction.update(approvals).set({ status: approved ? 'approved' : 'denied', decidedAt: now, decidedBy: options.decidedBy ?? null }).where(eq(approvals.id, approval.id))
    // Keep optional reasons in the existing audit log across partial decisions and restarts.
    if (responseReason) {
      const seq = ((await transaction.select({ seq: max(turnEvents.seq) }).from(turnEvents).where(eq(turnEvents.turnId, turn.id)))[0]?.seq ?? 0) + 1
      decisionEvent = { id: createId('event'), turnId: turn.id, seq, type: 'status', payload: { approvalId: approval.approvalId, approved, reason: responseReason, ...(decision === 'human_completed' ? { decision } : {}) }, createdAt: now }
      await transaction.insert(turnEvents).values(decisionEvent)
    }
    // rowid breaks equal-millisecond timestamps in insertion order (ULIDs are not monotonic).
    const decisions = await transaction.select().from(approvals).where(eq(approvals.turnId, turn.id)).orderBy(asc(approvals.createdAt), sql`${approvals}.rowid`)
    if (decisions.some((item) => item.status === 'pending')) return turn as Turn

    if (decisions.every((item) => item.resumeMode === 'connection')) {
      const [finished] = await transaction.update(turns).set({ status: approved ? 'done' : 'skipped', finishedAt: now }).where(eq(turns.id, turn.id)).returning()
      return finished as Turn
    }

    const stored = turn.modelMessages as unknown as ModelMessage[]
    const answered = new Set(stored.flatMap((message) => message.role === 'tool' && Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'tool-approval-response').map((part) => part.approvalId) : []))
    const audit = await transaction.select().from(turnEvents).where(and(eq(turnEvents.turnId, turn.id), eq(turnEvents.type, 'status'))).orderBy(asc(turnEvents.seq))
    const reasons = new Map(audit.flatMap(({ payload }) => typeof payload.approvalId === 'string' && typeof payload.reason === 'string' ? [[payload.approvalId, payload.reason] as const] : []))
    const responses: ToolApprovalResponse[] = decisions
      .filter((item) => item.resumeMode === 'tool' && !answered.has(item.approvalId) && ['approved', 'denied'].includes(item.status))
      .map((item) => ({ type: 'tool-approval-response', approvalId: item.approvalId, approved: item.status === 'approved', ...(reasons.has(item.approvalId) ? { reason: reasons.get(item.approvalId) } : {}) }))
    const followups = decisions.filter((item) => item.resumeMode === 'retry' && !stored.some((message) => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(`[Connection ${item.id}]`))).map((item) => ({ role: 'user', content: `[Connection ${item.id}] ${item.status === 'approved' ? `${item.connection?.appName} is connected again. Retry the failed action ${item.toolName} with its original input: ${JSON.stringify(item.input)}.` : `${item.connection?.appName} was not reconnected. Do not retry; explain that the connection is unavailable.`}` }))
    const modelMessages = JSON.parse(JSON.stringify([...stored, ...(responses.length ? [{ role: 'tool', content: responses }] : []), ...followups])) as JsonValue[]
    const [queued] = await transaction.update(turns).set({ status: 'queued', modelMessages, error: null, finishedAt: null }).where(and(eq(turns.id, turn.id), eq(turns.status, 'waiting_approval'))).returning()
    if (!queued) return null
    await transaction.update(bots).set({ status: 'idle' }).where(eq(bots.id, turn.botId))
    return queued as Turn
  }))
  if (decisionEvent && updatedTurn) options.hub?.broadcastRoom(updatedTurn.roomId, { type: 'turn.event', roomId: updatedTurn.roomId, turnId: updatedTurn.id, event: decisionEvent, ts: decisionEvent.createdAt })
  return updatedTurn
}
