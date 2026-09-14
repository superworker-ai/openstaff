import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { TurnEventRecorder } from '../agent/events.js'
import { BrowserService } from './service.js'
import { browserTools } from './tools.js'
import { turnEvents } from '../db/schema.js'
import { toolApprovalFor } from '../agent/approval-policy.js'
import type { ComputerLease } from '@openstaff/shared'
import type { ComputerLeaseGate } from '../computer/lease.js'

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('browses a real page with ARIA refs, typed input, and screenshot events', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Local browser test</title><h1>Welcome</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'input\').value">Greet</button>') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'browse' })
  const turn = posted.turns[0]!, session = browser.session(turn.id, new TurnEventRecorder(f.db, undefined, turn.id, f.roomId))
  const tools = browserTools(session), context = { toolCallId: 'call', messages: [], context: { turnId: turn.id, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } }
  try {
    const snapshot = await tools.browser_navigate.execute!({ url: `http://127.0.0.1:${port}` }, context)
    expect(snapshot).toContain('Welcome')
    const input = /textbox "Name" \[ref=(e\d+)\]/.exec(String(snapshot))?.[1]
    expect(input).toBeTruthy()
    await tools.browser_type.execute!({ ref: input!, text: 'Juan' }, context)
    await tools.browser_click.execute!({ selector: 'button' }, context)
    expect(await session.snapshot()).toContain('heading "Juan"')
    const screenshot = await session.screenshot()
    expect(screenshot?.title).toBe('Local browser test')
    const file = await fs.readFile(path.join(f.directory, screenshot!.url.replace('/api/', '')))
    expect(file.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect((await f.db.select().from(turnEvents)).filter((event) => event.type === 'screenshot').length).toBeGreaterThan(0)
    expect(await toolApprovalFor('writes')({ toolCall: { toolName: 'browser_click' } })).toBe('user-approval')
    expect(await toolApprovalFor('writes')({ toolCall: { toolName: 'browser_snapshot' } })).toBeUndefined()
    for (const toolName of ['computer_click', 'computer_double_click', 'computer_right_click', 'computer_drag', 'computer_type', 'computer_key', 'computer_scroll', 'computer_focus_window']) {
      expect(await toolApprovalFor('writes')({ toolCall: { toolName } })).toBe('user-approval')
    }
    for (const toolName of ['computer_screenshot', 'computer_move', 'computer_wait', 'computer_windows']) {
      expect(await toolApprovalFor('writes')({ toolCall: { toolName } })).toBeUndefined()
    }
  } finally { await session.close(); await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await f.close() }
}, 40_000)

it('returns a clear tool error when Chromium cannot launch', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory, async () => null, async () => { throw new Error('No executable') })
  const session = browser.session('turn_test', new TurnEventRecorder(f.db, undefined, 'turn_test', f.roomId))
  try { expect(await browserTools(session).browser_snapshot.execute!({}, { toolCallId: 'a', messages: [], context: { roomId: f.roomId, botId: f.botId, turnId: 'turn_test', handoffDepth: 0 } })).toEqual({ error: expect.stringContaining('Browser unavailable') }) }
  finally { await session.close(); await browser.close(); await f.close() }
})

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('blocks browser tools during human control and re-observes before resuming', async () => {
  const f = await fixture()
  let current: ComputerLease = { ownerKind: 'bot', ownerId: null, ownerName: null, epoch: 0, acquiredAt: new Date().toISOString(), expiresAt: null, reason: null }
  let returnControl: (() => void) | undefined
  const lease: ComputerLeaseGate = {
    current: vi.fn(async () => current),
    waitForBot: vi.fn((signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
      returnControl = resolve
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })),
  }
  const browser = new BrowserService(f.directory, undefined, undefined, undefined, { lease })
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Lease browser test</title><h1>Still here</h1>') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'wait for me' })
  const turn = posted.turns[0]!, session = browser.session(turn.id, new TurnEventRecorder(f.db, undefined, turn.id, f.roomId))
  const tools = browserTools(session), context = { toolCallId: 'lease-call', messages: [], context: { turnId: turn.id, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } }
  try {
    await tools.browser_navigate.execute!({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, context)
    current = { ownerKind: 'human', ownerId: f.userId, ownerName: 'Juan', epoch: 1, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: null }
    const blocked = Promise.resolve(tools.browser_snapshot.execute!({}, context) as PromiseLike<string | { error: string }>)
    await vi.waitFor(async () => expect((await f.db.select().from(turnEvents)).some((event) => event.payload.status === 'paused')).toBe(true))
    let settled = false
    void blocked.then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    current = { ownerKind: 'bot', ownerId: null, ownerName: null, epoch: 2, acquiredAt: new Date().toISOString(), expiresAt: null, reason: null }
    returnControl?.()
    await expect(blocked).resolves.toContain('Still here')
    const events = await f.db.select().from(turnEvents)
    const paused = events.find((event) => event.payload.status === 'paused')!
    const resumed = events.find((event) => event.payload.status === 'resumed')!
    const freshShot = events.find((event) => event.type === 'screenshot' && event.seq > resumed.seq)
    expect(paused.payload).toEqual({ status: 'paused', reason: 'human_control', by: 'Juan' })
    expect(resumed.payload).toEqual({ status: 'resumed', reason: 'control_returned' })
    expect(freshShot).toBeTruthy()
  } finally { await session.close(); await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await f.close() }
}, 40_000)
