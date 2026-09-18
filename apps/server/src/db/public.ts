import { inArray, eq } from 'drizzle-orm'
import { publicTurnSchema, type Approval, type PublicTurn, type Turn } from '@openstaff/shared'
import type { Database } from './index.js'
import { turns, users } from './schema.js'

export function publicTurn(turn: Turn): PublicTurn {
  return publicTurnSchema.parse(turn)
}

/** Approvals have no actor column: the acting member lives on the turn, so cards read it through this join. */
export async function publicApprovals(db: Database, rows: Approval[]): Promise<Approval[]> {
  if (!rows.length) return rows
  const actors = await db.select({ turnId: turns.id, actorUserId: turns.actorUserId, actorName: users.name })
    .from(turns).leftJoin(users, eq(users.id, turns.actorUserId))
    .where(inArray(turns.id, rows.map((row) => row.turnId)))
  const byTurn = new Map(actors.map((row) => [row.turnId, row]))
  return rows.map((row) => ({ ...row, actorUserId: byTurn.get(row.turnId)?.actorUserId ?? null, actorName: byTurn.get(row.turnId)?.actorName ?? null }))
}

export async function publicApproval(db: Database, row: Approval): Promise<Approval> {
  return (await publicApprovals(db, [row]))[0]!
}
