import { expect, it } from 'vitest'
import { formatTime } from './api'
import { sortRooms } from './room-order'

it('renders missing or invalid timestamps as empty text', () => {
  expect(formatTime(null)).toBe('')
  expect(formatTime('invalid')).toBe('')
})

it('keeps sections together, newest rooms first and empty rooms last', () => {
  const rooms = [
    { id: 1, section: 'Work', lastMessageAt: null },
    { id: 2, section: 'Work', lastMessageAt: '2026-01-01' },
    { id: 3, section: 'Work', lastMessageAt: '2026-02-01' },
  ]
  expect(sortRooms(rooms).map((room) => room.id)).toEqual([3, 2, 1])
  expect(sortRooms(rooms.map((room) => room.id === 2 ? { ...room, lastMessageAt: '2026-03-01' } : room)).map((room) => room.id)).toEqual([2, 3, 1])
})
