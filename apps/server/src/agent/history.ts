import { and, desc, eq, gt, ne } from 'drizzle-orm'
import type { Message } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { bots, messages, roomSummaries, users } from '../db/schema.js'

export async function labelMessage(db: Database, message: Message): Promise<string> {
  const entity = message.authorKind === 'bot' ? bots : users
  const author = message.authorKind === 'system' ? 'System'
    : (await db.select({ name: entity.name }).from(entity).where(eq(entity.id, message.authorId ?? '')).limit(1))[0]?.name ?? message.authorKind
  const files = message.attachments.filter((item) => item.subtype === 'file').map((item) => `Attached file: ${item.name} at ${item.path} (${item.size} bytes)`).join('\n')
  return `[${author}] ${message.text}${files ? `\n${files}` : ''}`
}

export async function loadRoomHistory(db: Database, roomId: string, limit: number, excludeId?: string): Promise<string> {
  const summary = (await db.select().from(roomSummaries).where(eq(roomSummaries.roomId, roomId)))[0]
  const rows = (await db.select().from(messages).where(and(
    eq(messages.roomId, roomId), excludeId ? ne(messages.id, excludeId) : undefined, summary ? gt(messages.seq, summary.upToSeq) : undefined,
  )).orderBy(desc(messages.seq)).limit(limit)).reverse()
  return [summary ? `Earlier in this room: ${summary.summary}` : '', ...(await Promise.all(rows.map((message) => labelMessage(db, message))))].filter(Boolean).join('\n')
}
