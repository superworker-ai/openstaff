import { describe, expect, it } from 'vitest'
import type { RoomView } from './loaders'
import { groupRoomsBySection, mergeSectionNames, normalizeSectionName, renameSectionInRegistry } from './room-sections'

const room = (id: string, section: string | null): RoomView => ({ id, section } as RoomView)

describe('room sections', () => {
  it('normalizes blank names to the Rooms bucket', () => {
    expect(normalizeSectionName('  ')).toBeNull()
    expect(normalizeSectionName('  Product  ')).toBe('Product')
  })

  it('keeps registered empty sections and deduplicates casing', () => {
    const groups = groupRoomsBySection([room('1', 'product'), room('2', null)], ['Product', 'Archive'])
    expect(groups.map((group) => [group.name, group.rooms.map((value) => value.id)])).toEqual([
      ['Archive', []],
      ['Product', ['1']],
      ['Rooms', ['2']],
    ])
  })

  it('includes assigned labels missing from a stale registry response', () => {
    expect(mergeSectionNames([], [room('1', 'Client work')])).toEqual(['Client work'])
  })

  it('groups legacy padded labels under their trimmed section', () => {
    expect(groupRoomsBySection([room('1', '  Product  ')], ['Product'])[0]?.rooms.map((value) => value.id)).toEqual(['1'])
  })

  it('replaces the old registry entry for case-only and regular renames', () => {
    expect(renameSectionInRegistry(['Archive', 'product'], 'product', 'Product')).toEqual(['Archive', 'Product'])
    expect(renameSectionInRegistry(['Archive', 'Product'], 'Product', 'Client work')).toEqual(['Archive', 'Client work'])
  })
})
