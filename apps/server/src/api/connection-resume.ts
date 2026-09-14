import { and, eq } from 'drizzle-orm'
import type { AppConnection } from '@openstaff/shared'
import { approvals, roomMembers } from '../db/schema.js'
import { appendApprovalResponse } from '../agent/approval-responses.js'
import { AgentConnections } from '../agent/connections.js'
import type { ApiDependencies } from './context.js'
import { publicTurn } from '../db/public.js'

export async function connectionApproval({ db }: ApiDependencies, id: string, userId: string, completed = false) {
  return (await db.select({ approval: approvals }).from(approvals).innerJoin(roomMembers, eq(roomMembers.roomId, approvals.roomId)).where(and(eq(approvals.id, id), eq(approvals.kind, 'connect'), completed ? undefined : eq(approvals.status, 'pending'), eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId))).limit(1))[0]?.approval
}
export async function resumeConnections(dependencies: ApiDependencies, connection: AppConnection, userId: string, id?: string) {
  const { db, hub, admission, scheduler, registry, composio } = dependencies
  if (!await new AgentConnections(registry, composio).connected(connection)) throw new Error('Connection is not active yet. Complete sign-in and try again.')
  hub.broadcastAll({ type: 'connection.updated', app: connection.appName, status: 'connected', ts: new Date().toISOString() })
  const pending = await db.select().from(approvals).where(and(eq(approvals.kind, 'connect'), eq(approvals.status, 'pending')))
  for (const row of pending) {
    if (id && row.id !== id) continue
    const target = row.connection
    if (!target || target.source !== connection.source || target.pluginId !== connection.pluginId || target.serverName !== connection.serverName || target.toolkit !== connection.toolkit) continue
    if (!await connectionApproval(dependencies, row.id, userId)) continue
    const turn = await appendApprovalResponse(db, row.id, true, `Connected ${connection.appName}`, { decidedBy: userId, hub, admission })
    if (!turn) continue
    const updated = (await db.select().from(approvals).where(eq(approvals.id, row.id)))[0]!
    hub.broadcastRoom(row.roomId, { type: 'approval.updated', approval: updated, ts: new Date().toISOString() })
    hub.broadcastRoom(row.roomId, { type: 'turn.updated', turn: publicTurn(turn), ts: new Date().toISOString() })
    if (turn.status === 'queued') scheduler.enqueue([turn])
  }
}
