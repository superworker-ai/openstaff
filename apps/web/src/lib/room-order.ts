export function sortRooms<T extends { section: string | null; lastMessageAt: string | null }>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => (a.section ?? '').localeCompare(b.section ?? '') || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}
