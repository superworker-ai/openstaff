import type { Message } from '@openstaff/shared'

export function groupedWithPrevious(previous: Message | undefined, current: Message): boolean {
  if (!previous || current.authorKind === 'system' || previous.authorKind !== current.authorKind || previous.authorId !== current.authorId) return false
  const gap = Date.parse(current.createdAt) - Date.parse(previous.createdAt)
  return gap >= 0 && gap <= 120_000 && new Date(current.createdAt).toDateString() === new Date(previous.createdAt).toDateString()
}
