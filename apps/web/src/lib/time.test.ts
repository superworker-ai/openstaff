import { expect, it } from 'vitest'
import { relativeTime } from './time.js'

const local = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute)

it('formats near future and recent past times compactly', () => {
  const now = local(15, 10)
  expect(relativeTime(local(15, 12).toISOString(), now)).toBe('in 2h')
  expect(relativeTime(local(15, 9, 30).toISOString(), now)).toBe('30m ago')
  expect(relativeTime(local(15, 10, 0).toISOString(), now)).toBe('just now')
})

it('labels adjacent calendar days with their local clock time', () => {
  const now = local(15, 18)
  expect(relativeTime(local(16, 8).toISOString(), now)).toBe('tomorrow 8:00 AM')
  expect(relativeTime(local(14, 16, 12).toISOString(), now)).toBe('yesterday 4:12 PM')
})

it('returns an empty label for invalid input', () => {
  expect(relativeTime('not-a-date', local(15, 10))).toBe('')
})
