import type { DesktopInputAction } from '@openstaff/shared'

const KEY_CHORD = /^[A-Za-z0-9_+]+$/

function coordinate(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error(`${name} must be an integer from 0 to 10000`)
  return String(value)
}

export function desktopInputArguments(action: DesktopInputAction): string[] {
  switch (action.type) {
    case 'click': {
      const button = action.button ?? 1
      if (![1, 2, 3].includes(button)) throw new Error('button must be 1, 2, or 3')
      return ['click', coordinate(action.x, 'x'), coordinate(action.y, 'y'), String(button)]
    }
    case 'double_click': return ['dblclick', coordinate(action.x, 'x'), coordinate(action.y, 'y')]
    case 'right_click': return ['click', coordinate(action.x, 'x'), coordinate(action.y, 'y'), '3']
    case 'move': return ['move', coordinate(action.x, 'x'), coordinate(action.y, 'y')]
    case 'drag': return ['drag', coordinate(action.fromX, 'fromX'), coordinate(action.fromY, 'fromY'), coordinate(action.toX, 'toX'), coordinate(action.toY, 'toY')]
    case 'type': {
      if (action.text.length > 4096) throw new Error('text must be at most 4096 characters')
      return ['type-b64', Buffer.from(action.text).toString('base64')]
    }
    case 'key': {
      if (!KEY_CHORD.test(action.key)) throw new Error('key must contain only letters, numbers, underscore, and +')
      return ['key', action.key]
    }
    case 'scroll': {
      if (!Number.isSafeInteger(action.amount) || action.amount < 1 || action.amount > 20) throw new Error('amount must be an integer from 1 to 20')
      return ['scroll', coordinate(action.x, 'x'), coordinate(action.y, 'y'), action.direction, String(action.amount)]
    }
  }
}
