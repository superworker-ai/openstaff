import { computerActivityLine } from './computer-activity.js'
import type { JsonValue, TurnEvent } from './schemas.js'

export type ActivityIcon = 'terminal' | 'file' | 'globe' | 'pointer' | 'camera' | 'keyboard' | 'tool'

export interface ActivityStep {
  kind: 'phase' | 'step'
  icon: ActivityIcon
  verb: string
  object: string
  objectIsCode: boolean
  detail?: string
  raw?: string
}

export interface ActivityStepResult {
  ok: boolean
  durationMs?: number
  output?: string
  exitCode?: number
}

export interface ActivityEntry extends ActivityStep {
  event: TurnEvent
  state: 'running' | 'ok' | 'fail'
  toolName?: string
  result?: ActivityStepResult
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function title(value: string): string {
  return value.split(/[_-]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

function urlLabel(value: string): string {
  try {
    const url = new URL(value)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value.replace(/^https?:\/\//, '').split(/[?#]/, 1)[0] ?? value
  }
}

function computerIcon(toolName: string): ActivityIcon {
  if (toolName === 'computer_screenshot') return 'camera'
  if (toolName === 'computer_type' || toolName === 'computer_key') return 'keyboard'
  if (/_(click|move|drag|scroll)/.test(toolName)) return 'pointer'
  return 'tool'
}

export function describeEvent(event: TurnEvent): ActivityStep | null {
  if (event.type === 'status') {
    const rawStatus = text(event.payload.status, 'Working')
    const status = rawStatus === 'waiting_approval' ? 'Waiting for approval' : rawStatus.replaceAll('_', ' ')
    return { kind: 'phase', icon: 'tool', verb: status, object: '', objectIsCode: false }
  }
  if (event.type === 'screenshot') {
    return { kind: 'step', icon: 'camera', verb: 'Captured', object: text(event.payload.title, 'the screen'), objectIsCode: false }
  }
  if (event.type !== 'tool-call') return null

  const toolName = text(event.payload.toolName, event.type)
  const input = record(event.payload.input)
  const selector = text(input.selector, text(input.ref, '?'))
  switch (toolName) {
    case 'shell': {
      const command = text(input.command, '?')
      return { kind: 'step', icon: 'terminal', verb: 'Ran', object: command, objectIsCode: true, detail: text(input.cwd) || undefined, raw: command }
    }
    case 'write_file':
      return { kind: 'step', icon: 'file', verb: 'Wrote', object: text(input.path, '?'), objectIsCode: true }
    case 'read_file':
      return { kind: 'step', icon: 'file', verb: 'Read', object: text(input.path, '?'), objectIsCode: true }
    case 'edit_file':
      return { kind: 'step', icon: 'file', verb: 'Edited', object: text(input.path, '?'), objectIsCode: true }
    case 'browser_navigate':
      return { kind: 'step', icon: 'globe', verb: 'Opened', object: urlLabel(text(input.url, '?')), objectIsCode: false }
    case 'browser_click':
      return { kind: 'step', icon: 'pointer', verb: 'Clicked', object: selector, objectIsCode: true }
    case 'browser_type':
      return { kind: 'step', icon: 'keyboard', verb: 'Typed into', object: selector, objectIsCode: true }
    case 'request_connection':
      return { kind: 'step', icon: 'tool', verb: 'Asked to connect', object: text(input.app, '?'), objectIsCode: false }
  }

  if (toolName.startsWith('computer_')) {
    const line = computerActivityLine(event) ?? toolName.replaceAll('_', ' ')
    const separator = line.indexOf(' ')
    return {
      kind: 'step',
      icon: computerIcon(toolName),
      verb: separator < 0 ? line : line.slice(0, separator),
      object: separator < 0 ? '' : line.slice(separator + 1),
      objectIsCode: false,
    }
  }

  const plugin = /^([^_]+)__(.+)$/.exec(toolName)
  if (plugin) {
    return { kind: 'step', icon: 'tool', verb: 'Used', object: `${title(plugin[1]!)} · ${plugin[2]!.replaceAll('_', ' ')}`, objectIsCode: false }
  }
  return { kind: 'step', icon: 'tool', verb: toolName.replaceAll('_', ' '), object: '', objectIsCode: false }
}

function outputText(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(outputText).filter(Boolean).join('\n') || undefined
  const valueRecord = record(value)
  const stdout = text(valueRecord.stdout)
  const stderr = text(valueRecord.stderr)
  if (stdout || stderr) return [stdout, stderr].filter(Boolean).join('\n')
  if (typeof valueRecord.value === 'string') return valueRecord.value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function pairedResult(call: TurnEvent, result: TurnEvent): ActivityStepResult {
  const output = result.payload.output
  const outputRecord = record(output)
  const explicitError = text(result.payload.error) || text(outputRecord.error)
  const exitCodeValue = outputRecord.code ?? outputRecord.exitCode ?? outputRecord.exit
  const exitCode = typeof exitCodeValue === 'number' ? exitCodeValue : undefined
  const errorOutput = explicitError || (result.payload.denied === true ? 'Denied' : undefined)
  const typedError = outputRecord.type === 'error-text' || outputRecord.type === 'execution-denied'
  const duration = Date.parse(result.createdAt) - Date.parse(call.createdAt)
  return {
    ok: !errorOutput && !typedError && (exitCode === undefined || exitCode === 0),
    ...(Number.isFinite(duration) ? { durationMs: Math.max(0, duration) } : {}),
    ...(outputText(output) || errorOutput ? { output: errorOutput || outputText(output) } : {}),
    ...(exitCode === undefined ? {} : { exitCode }),
  }
}

export function pairActivityEvents(events: TurnEvent[]): ActivityEntry[] {
  const results = new Map<string, TurnEvent>()
  for (const event of events) {
    if (event.type === 'tool-result' && typeof event.payload.toolCallId === 'string') results.set(event.payload.toolCallId, event)
  }
  const entries: ActivityEntry[] = []
  for (const event of events) {
    const description = describeEvent(event)
    if (!description) continue
    if (description.kind === 'phase') {
      entries.push({ ...description, event, state: 'ok' })
      continue
    }
    if (event.type !== 'tool-call') {
      entries.push({ ...description, event, state: 'ok' })
      continue
    }
    const toolCallId = text(event.payload.toolCallId)
    const matching = toolCallId ? results.get(toolCallId) : undefined
    const result = matching ? pairedResult(event, matching) : undefined
    entries.push({
      ...description,
      event,
      toolName: text(event.payload.toolName) || undefined,
      state: result ? result.ok ? 'ok' : 'fail' : 'running',
      ...(result ? { result } : {}),
    })
  }
  return entries
}
