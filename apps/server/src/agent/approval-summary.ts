export function approvalSummary(tool: string, value: unknown): string {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const text = (key: string) => typeof input[key] === 'string' ? input[key] as string : '?'
  if (tool === 'write_file') return `Write ${text('path')} (${Buffer.byteLength(text('content'))} bytes)`
  if (tool === 'edit_file') return `Edit ${text('path')}`
  if (tool === 'shell') return `Run: ${text('command')}`
  if (tool === 'browser_click') return `Click ${input.ref ?? input.selector ?? '?'}`
  if (tool === 'browser_type') return `Type into ${input.ref ?? input.selector ?? '?'}`
  if (tool === 'computer_click') return `Click at ${input.x ?? '?'},${input.y ?? '?'}`
  if (tool === 'computer_double_click') return `Double-click at ${input.x ?? '?'},${input.y ?? '?'}`
  if (tool === 'computer_right_click') return `Right-click at ${input.x ?? '?'},${input.y ?? '?'}`
  if (tool === 'computer_drag') return `Drag ${input.fromX ?? '?'},${input.fromY ?? '?'} to ${input.toX ?? '?'},${input.toY ?? '?'}`
  if (tool === 'computer_type') return `Type ${JSON.stringify(text('text').slice(0, 80))}${text('text').length > 80 ? '…' : ''}`
  if (tool === 'computer_key') return `Press ${text('key')}`
  if (tool === 'computer_scroll') return `Scroll ${text('direction')} at ${input.x ?? '?'},${input.y ?? '?'}`
  if (tool === 'computer_focus_window') return `Focus window ${input.id ?? input.titleContains ?? '?'}`
  if (tool === 'composio_execute') return `${text('slug')} in ${text('slug').split('_')[0]?.toLowerCase()}`
  if (tool.includes('__')) return tool.split('__').join(': ')
  return tool.replaceAll('_', ' ')
}
