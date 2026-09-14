import { expect, it } from 'vitest'
import type { TurnEvent } from '@openstaff/shared'
import { computerActivityLine } from './computer-activity.js'

function event(toolName: string, input: Record<string, string | number>): TurnEvent {
  return { id: 'evt_test', turnId: 'turn_test', seq: 1, type: 'tool-call', payload: { toolName, input }, createdAt: new Date().toISOString() }
}

it('formats desktop activity as compact coordinate-aware actions', () => {
  expect(computerActivityLine(event('computer_click', { x: 412, y: 300 }))).toBe('Click 412,300')
  expect(computerActivityLine(event('computer_drag', { fromX: 1, fromY: 2, toX: 3, toY: 4 }))).toBe('Drag 1,2 to 3,4')
  expect(computerActivityLine(event('computer_type', { text: '[redacted 5 characters]' }))).toBe('Type 5 characters')
  expect(computerActivityLine(event('computer_key', { key: 'ctrl+l' }))).toBe('Press ctrl+l')
})
