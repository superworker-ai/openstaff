import { expect, it } from 'vitest'
import type { Message } from '@openstaff/shared'
import { groupedWithPrevious } from './message-grouping'

it('groups only the same author within two minutes on the same day', () => {
  const first = { authorKind: 'bot', authorId: 'drake', createdAt: '2026-09-12T12:00:00Z' } as Message
  expect(groupedWithPrevious(first, { ...first, createdAt: '2026-09-12T12:02:00Z' })).toBe(true)
  expect(groupedWithPrevious(first, { ...first, createdAt: '2026-09-12T12:02:01Z' })).toBe(false)
  expect(groupedWithPrevious(first, { ...first, authorId: 'john' })).toBe(false)
  expect(groupedWithPrevious(undefined, first)).toBe(false)
})
