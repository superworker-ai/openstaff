import type { RoomView } from './loaders'

export const ROOM_SECTION_MAX_LENGTH = 80

export interface RoomSectionGroup {
  key: string | null
  name: string
  rooms: RoomView[]
}

export function normalizeSectionName(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function mergeSectionNames(registry: string[], rooms: RoomView[]): string[] {
  const names = new Map<string, string>()
  for (const value of [...registry, ...rooms.map((room) => room.section ?? '')]) {
    const name = normalizeSectionName(value)
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
}

export function renameSectionInRegistry(registry: string[], previousName: string, nextName: string): string[] {
  const previousKey = previousName.trim().toLowerCase()
  return mergeSectionNames([...registry.filter((name) => name.trim().toLowerCase() !== previousKey), nextName], [])
}

export function groupRoomsBySection(rooms: RoomView[], registry: string[]): RoomSectionGroup[] {
  const sections = mergeSectionNames(registry, rooms)
  const groups: RoomSectionGroup[] = sections.map((name) => ({
    key: name,
    name,
    rooms: rooms.filter((room) => normalizeSectionName(room.section)?.toLowerCase() === name.toLowerCase()),
  }))
  groups.push({ key: null, name: 'Rooms', rooms: rooms.filter((room) => !normalizeSectionName(room.section)) })
  return groups
}
