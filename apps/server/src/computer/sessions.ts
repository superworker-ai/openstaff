import { and, eq, isNull, ne, or } from 'drizzle-orm'
import type { ComputerProviderId } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { computerSessions } from '../db/schema.js'

export type ComputerSessionEndReason = 'superseded' | 'stopped' | 'destroyed' | 'idle' | 'restart'

export async function openComputerSession(db: Database, provider: ComputerProviderId, externalId: string, startedAt = new Date().toISOString()): Promise<void> {
  const current = (await db.select().from(computerSessions).where(and(eq(computerSessions.provider, provider), isNull(computerSessions.endedAt))).limit(1))[0]
  if (current?.externalId === externalId) return
  await db.transaction(async (transaction) => {
    await transaction.update(computerSessions).set({ endedAt: startedAt, endReason: 'superseded' }).where(and(eq(computerSessions.provider, provider), isNull(computerSessions.endedAt)))
    await transaction.insert(computerSessions).values({ id: `cps_${crypto.randomUUID()}`, provider, externalId, startedAt, endedAt: null, endReason: null })
  })
}

export async function closeComputerSession(db: Database, provider: ComputerProviderId, endReason: ComputerSessionEndReason, endedAt = new Date().toISOString()): Promise<void> {
  await db.update(computerSessions).set({ endedAt, endReason }).where(and(eq(computerSessions.provider, provider), isNull(computerSessions.endedAt)))
}

export async function closeUnresumedComputerSessions(db: Database, resumed?: { provider: ComputerProviderId; externalId: string }): Promise<void> {
  const condition = resumed
    ? and(isNull(computerSessions.endedAt), or(ne(computerSessions.provider, resumed.provider), ne(computerSessions.externalId, resumed.externalId)))
    : isNull(computerSessions.endedAt)
  await db.update(computerSessions).set({ endedAt: new Date().toISOString(), endReason: 'restart' }).where(condition)
}
