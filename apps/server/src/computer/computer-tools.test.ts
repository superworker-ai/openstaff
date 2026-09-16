import { expect, it, vi } from 'vitest'
import type { ComputerLease } from '@openstaff/shared'
import { fixture } from '../test/fixture.js'
import { TurnEventRecorder } from '../agent/events.js'
import { turnEvents } from '../db/schema.js'
import type { ComputerLeaseGate } from './lease.js'
import { DisplayGate } from './display-gate.js'
import { ScreenRecorder } from './screen-recorder.js'
import { ComputerUseSession, computerModelOutput, computerTools, computerToolSchemas, desktopWindows, type ComputerToolOutput, type DesktopToolComputer } from './computer-tools.js'

function desktopComputer() {
  const captureScreen = vi.fn(async () => ({ image: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]), mediaType: 'image/jpeg' as const, width: 1280, height: 800 }))
  const desktopInput = vi.fn(async () => undefined)
  const exec = vi.fn(async (command: string) => command.includes('getmouselocation')
    ? { stdout: 'X=412\nY=300\nSCREEN=0\nWINDOW=1\n', stderr: '', code: 0 }
    : command.includes('wmctrl -l')
      ? { stdout: '0x03e00007  0 host Chromium\n0x04a00003  0 host Settings\n', stderr: '', code: 0 }
      : command.includes('_NET_ACTIVE_WINDOW')
        ? { stdout: '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3e00007\n', stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 0 })
  const computer = { root: '/workspace', captureScreen, desktopInput, exec } as unknown as DesktopToolComputer
  return { computer, captureScreen, desktopInput, exec }
}

it('enforces coordinate, text, scroll, wait, key, and window schema bounds', () => {
  expect(() => computerToolSchemas.click.parse({ x: -1, y: 0 })).toThrow()
  expect(() => computerToolSchemas.click.parse({ x: 1.5, y: 0 })).toThrow()
  expect(() => computerToolSchemas.type.parse({ text: 'x'.repeat(4097) })).toThrow()
  expect(() => computerToolSchemas.key.parse({ key: 'ctrl+l;rm' })).toThrow()
  expect(() => computerToolSchemas.scroll.parse({ x: 0, y: 0, direction: 'down', amount: 21 })).toThrow()
  expect(() => computerToolSchemas.wait.parse({ seconds: 10.1 })).toThrow()
  expect(() => computerToolSchemas.focusWindow.parse({})).toThrow()
  expect(() => computerToolSchemas.focusWindow.parse({ id: '0x1', titleContains: 'Chrome' })).toThrow()
  expect(computerToolSchemas.focusWindow.parse({ titleContains: 'Chrome' })).toEqual({ titleContains: 'Chrome' })
})

it('returns text plus an image-data part from a recorded screenshot', async () => {
  const f = await fixture()
  try {
    const turnId = (await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'screen' })).turns[0]!.id
    const recorder = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
    const screen = new ScreenRecorder(f.directory, turnId, recorder)
    const output = await screen.saveJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { source: 'desktop', width: 1280, height: 800 })
    const model = await computerModelOutput(screen, { ...output, width: 1280, height: 800, cursor: { x: 412, y: 300 }, message: 'clicked' })
    expect(model).toEqual({ type: 'content', value: [
      { type: 'text', text: expect.stringContaining('screen 1280x800, cursor at 412,300') },
      { type: 'image-data', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'), mediaType: 'image/jpeg' },
    ] })
  } finally { await f.close() }
})

it('throttles automatic screenshots to one per 700 ms while explicit screenshots bypass it', async () => {
  const f = await fixture(), fake = desktopComputer()
  let now = 1000
  try {
    const turnId = (await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'throttle' })).turns[0]!.id
    const recorder = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
    const screen = new ScreenRecorder(f.directory, turnId, recorder)
    const session = new ComputerUseSession(fake.computer, screen, new DisplayGate(), recorder, undefined, { sleep: async () => undefined, now: () => now })
    const tools = computerTools(session, screen)
    const context = { toolCallId: 'call', messages: [], context: { turnId, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } }
    const first = await tools.computer_click.execute!({ x: 1, y: 2 }, context) as ComputerToolOutput
    const second = await tools.computer_click.execute!({ x: 3, y: 4 }, context) as ComputerToolOutput
    await tools.computer_screenshot.execute!({}, context)
    expect(first.url).toBe(`/api/screens/${turnId}/1.jpg`)
    expect(second).toEqual({ message: 'action done; call computer_screenshot to observe' })
    expect(fake.captureScreen).toHaveBeenCalledTimes(2)
    now += 700
    expect((await tools.computer_click.execute!({ x: 5, y: 6 }, context) as ComputerToolOutput).url).toBe(`/api/screens/${turnId}/3.jpg`)
  } finally { await f.close() }
})

it('pauses a desktop click for human control and records resume plus a fresh desktop screenshot', async () => {
  const f = await fixture(), fake = desktopComputer()
  let current: ComputerLease = { ownerKind: 'human', ownerId: f.userId, ownerName: 'Juan', epoch: 1, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: null }
  let release!: () => void
  const lease: ComputerLeaseGate = { current: vi.fn(async () => current), waitForBot: vi.fn(() => new Promise<void>((resolve) => { release = resolve })) }
  try {
    const turnId = (await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'gate' })).turns[0]!.id
    const recorder = new TurnEventRecorder(f.db, undefined, turnId, f.roomId)
    const screen = new ScreenRecorder(f.directory, turnId, recorder)
    const session = new ComputerUseSession(fake.computer, screen, new DisplayGate(lease), recorder, undefined, { sleep: async () => undefined, now: () => 1000 })
    const pending = session.action(() => session.input({ type: 'click', x: 10, y: 20 }), 'clicked')
    await vi.waitFor(async () => expect((await f.db.select().from(turnEvents)).some((event) => event.payload.status === 'paused')).toBe(true))
    expect(fake.desktopInput).not.toHaveBeenCalled()
    current = { ownerKind: 'bot', ownerId: null, ownerName: null, epoch: 2, acquiredAt: new Date().toISOString(), expiresAt: null, reason: null }
    release()
    await pending
    const events = await f.db.select().from(turnEvents)
    const resumed = events.find((event) => event.payload.status === 'resumed')!
    expect(events.find((event) => event.type === 'screenshot' && event.seq > resumed.seq)?.payload).toMatchObject({ source: 'desktop', width: 1280, height: 800 })
    expect(fake.desktopInput).toHaveBeenCalledWith({ type: 'click', x: 10, y: 20 })
  } finally { await f.close() }
})

it('parses and marks the active wmctrl window', async () => {
  const fake = desktopComputer()
  await expect(desktopWindows(fake.computer)).resolves.toEqual([
    { id: '0x03e00007', title: 'Chromium', active: true },
    { id: '0x04a00003', title: 'Settings', active: false },
  ])
})
