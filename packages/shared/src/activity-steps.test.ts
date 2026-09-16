import { describe, expect, it } from 'vitest'
import type { TurnEvent } from './schemas.js'
import { describeEvent, pairActivityEvents } from './activity-steps.js'

let seq = 0
function event(type: TurnEvent['type'], payload: TurnEvent['payload'], createdAt = '2026-01-01T00:00:00.000Z'): TurnEvent {
  seq += 1
  return { id: `event_${seq}`, turnId: 'turn_test', seq, type, payload, createdAt }
}

describe('describeEvent', () => {
  it('describes status and screenshot events', () => {
    expect(describeEvent(event('status', { status: 'Running the load test' }))).toMatchObject({ kind: 'phase', verb: 'Running the load test' })
    expect(describeEvent(event('status', { status: 'waiting_approval' }))).toMatchObject({ kind: 'phase', verb: 'Waiting for approval' })
    expect(describeEvent(event('screenshot', { title: 'Metrics dashboard' }))).toMatchObject({ icon: 'camera', verb: 'Captured', object: 'Metrics dashboard' })
  })

  it('describes shell calls with their command and cwd', () => {
    expect(describeEvent(event('tool-call', { toolName: 'shell', input: { command: 'hey --help', cwd: '/workspace' } }))).toEqual({
      kind: 'step', icon: 'terminal', verb: 'Ran', object: 'hey --help', objectIsCode: true, detail: '/workspace', raw: 'hey --help',
    })
  })

  it.each([
    ['write_file', 'Wrote'],
    ['read_file', 'Read'],
    ['edit_file', 'Edited'],
  ])('describes %s calls', (toolName, verb) => {
    expect(describeEvent(event('tool-call', { toolName, input: { path: 'reports/load-test.md' } }))).toMatchObject({ icon: 'file', verb, object: 'reports/load-test.md', objectIsCode: true })
  })

  it('describes browser calls', () => {
    expect(describeEvent(event('tool-call', { toolName: 'browser_navigate', input: { url: 'https://example.test/admin/metrics?range=1h' } }))).toMatchObject({ icon: 'globe', verb: 'Opened', object: 'example.test/admin/metrics' })
    expect(describeEvent(event('tool-call', { toolName: 'browser_click', input: { selector: 'button.save' } }))).toMatchObject({ icon: 'pointer', verb: 'Clicked', object: 'button.save', objectIsCode: true })
    expect(describeEvent(event('tool-call', { toolName: 'browser_type', input: { ref: 'e12' } }))).toMatchObject({ icon: 'keyboard', verb: 'Typed into', object: 'e12' })
  })

  it('reuses computer activity descriptions', () => {
    expect(describeEvent(event('tool-call', { toolName: 'computer_click', input: { x: 41, y: 22 } }))).toMatchObject({ icon: 'pointer', verb: 'Click', object: '41,22' })
    expect(describeEvent(event('tool-call', { toolName: 'computer_key', input: { key: 'Enter' } }))).toMatchObject({ icon: 'keyboard', verb: 'Press', object: 'Enter' })
  })

  it('describes connection, plugin, and fallback calls', () => {
    expect(describeEvent(event('tool-call', { toolName: 'request_connection', input: { app: 'Google Drive' } }))).toMatchObject({ verb: 'Asked to connect', object: 'Google Drive' })
    expect(describeEvent(event('tool-call', { toolName: 'gmail__read_mail', input: {} }))).toMatchObject({ verb: 'Used', object: 'Gmail · read mail' })
    expect(describeEvent(event('tool-call', { toolName: 'list_dir', input: {} }))).toMatchObject({ verb: 'list dir', object: '' })
  })
})

describe('pairActivityEvents', () => {
  it('pairs results and derives output, exit status, and duration', () => {
    const call = event('tool-call', { toolName: 'shell', toolCallId: 'call_1', input: { command: 'false' } }, '2026-01-01T00:00:00.000Z')
    const result = event('tool-result', { toolName: 'shell', toolCallId: 'call_1', output: { stdout: 'before', stderr: 'failed', code: 7 } }, '2026-01-01T00:00:00.240Z')
    expect(pairActivityEvents([call, result])[0]).toMatchObject({ state: 'fail', result: { ok: false, durationMs: 240, exitCode: 7, output: 'before\nfailed' } })
  })

  it('keeps an unmatched call running and completes a successful call', () => {
    const running = event('tool-call', { toolName: 'read_file', toolCallId: 'call_running', input: { path: 'a.md' } })
    expect(pairActivityEvents([running])[0]?.state).toBe('running')
    expect(pairActivityEvents([running])[0]?.result).toBeUndefined()
    const done = event('tool-result', { toolName: 'read_file', toolCallId: 'call_running', output: 'hello' }, '2026-01-01T00:00:01.000Z')
    expect(pairActivityEvents([running, done])[0]).toMatchObject({ state: 'ok', result: { ok: true, durationMs: 1000, output: 'hello' } })
  })

  it('marks recorded errors as failed results', () => {
    const call = event('tool-call', { toolName: 'browser_click', toolCallId: 'call_error', input: { selector: '#save' } })
    const result = event('tool-result', { toolName: 'browser_click', toolCallId: 'call_error', error: 'Element not found' })
    expect(pairActivityEvents([call, result])[0]).toMatchObject({ state: 'fail', result: { ok: false, output: 'Element not found' } })
  })
})
