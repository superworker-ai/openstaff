import { createId, type JsonValue } from '@openstaff/shared'
import type { Database } from './db/index.js'
import { auditLog } from './db/schema.js'

export interface AuditEvent {
  actorUserId?: string | null
  actorIp?: string | null
  event: string
  targetType: string
  targetId: string
  metadata?: Record<string, JsonValue>
}

export type AuditWriter = (event: AuditEvent) => Promise<void>

export function requestIp(headers: Headers | undefined): string {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  return headers?.get('cf-connecting-ip') || forwarded || headers?.get('x-real-ip') || 'unknown'
}

export function createAuditWriter(db: Database): AuditWriter {
  return async (event) => {
    await db.insert(auditLog).values({
      id: createId('audit'), at: new Date().toISOString(), actorUserId: event.actorUserId ?? null,
      actorIp: event.actorIp || 'unknown', event: event.event, targetType: event.targetType,
      targetId: event.targetId, metadata: event.metadata ?? {},
    })
  }
}
