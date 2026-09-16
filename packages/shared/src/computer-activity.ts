import type { TurnEvent } from './schemas.js'

export function computerActivityLine(event: TurnEvent): string | null {
  if (event.type !== 'tool-call' || typeof event.payload.toolName !== 'string' || !event.payload.toolName.startsWith('computer_')) return null
  const tool = event.payload.toolName, input = event.payload.input && typeof event.payload.input === 'object' && !Array.isArray(event.payload.input) ? event.payload.input : {}
  const value = (key: string) => String(input[key] ?? '?')
  if (tool === 'computer_screenshot') return 'Take desktop screenshot'
  if (tool === 'computer_click') return `Click ${value('x')},${value('y')}${input.button ? ` button ${value('button')}` : ''}`
  if (tool === 'computer_double_click') return `Double-click ${value('x')},${value('y')}`
  if (tool === 'computer_right_click') return `Right-click ${value('x')},${value('y')}`
  if (tool === 'computer_move') return `Move to ${value('x')},${value('y')}`
  if (tool === 'computer_drag') return `Drag ${value('fromX')},${value('fromY')} to ${value('toX')},${value('toY')}`
  if (tool === 'computer_type') return `Type ${/\d+/.exec(value('text'))?.[0] ?? '?'} characters`
  if (tool === 'computer_key') return `Press ${value('key')}`
  if (tool === 'computer_scroll') return `Scroll ${value('direction')} at ${value('x')},${value('y')}${input.amount ? ` ×${value('amount')}` : ''}`
  if (tool === 'computer_wait') return `Wait ${value('seconds')} seconds`
  if (tool === 'computer_windows') return 'List desktop windows'
  if (tool === 'computer_focus_window') return `Focus window ${value(input.id ? 'id' : 'titleContains')}`
  return tool.replaceAll('_', ' ')
}
