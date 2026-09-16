import { tool } from 'ai'
import { z } from 'zod'
import type { DesktopInputAction } from '@openstaff/shared'
import { toolContextSchema } from '../agent/tools.js'
import type { TurnEventRecorder } from '../agent/events.js'
import type { Computer, DesktopCapture, DesktopWindow } from './types.js'
import type { DisplayGate } from './display-gate.js'
import type { ScreenRecorder } from './screen-recorder.js'

const coordinate = z.number().int().min(0).max(10_000)
const point = z.object({ x: coordinate, y: coordinate })
const keyChord = z.string().min(1).max(100).regex(/^[A-Za-z0-9_+]+$/)

export const computerToolSchemas = {
  screenshot: z.object({}),
  click: point.extend({ button: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }),
  doubleClick: point,
  rightClick: point,
  move: point,
  drag: z.object({ fromX: coordinate, fromY: coordinate, toX: coordinate, toY: coordinate }),
  type: z.object({ text: z.string().max(4096) }),
  key: z.object({ key: keyChord }),
  scroll: point.extend({ direction: z.enum(['up', 'down']), amount: z.number().int().min(1).max(20).optional() }),
  wait: z.object({ seconds: z.number().min(0).max(10) }),
  windows: z.object({}),
  focusWindow: z.object({ id: z.string().regex(/^0x[0-9a-f]+$/i).optional(), titleContains: z.string().min(1).max(256).optional() })
    .refine((input) => Number(Boolean(input.id)) + Number(Boolean(input.titleContains)) === 1, 'Provide exactly one of id or titleContains'),
}

export interface DesktopToolComputer extends Computer {
  captureScreen(options?: { quality?: number }): Promise<DesktopCapture>
  desktopInput(action: DesktopInputAction): Promise<void>
  desktopCursor?(): Promise<{ x: number; y: number } | null>
  desktopWindows?(): Promise<DesktopWindow[] | null>
  focusDesktopWindow?(input: { id?: string; titleContains?: string }): Promise<boolean | void>
}

export interface ComputerToolOutput { message?: string; url?: string; mediaType?: 'image/jpeg' | 'image/png'; width?: number; height?: number; cursor?: { x: number; y: number } }
interface SessionOptions { sleep?: (milliseconds: number) => Promise<void>; now?: () => number }

function failure(error: unknown): ComputerToolOutput { return { message: `error: ${error instanceof Error ? error.message : String(error)}` } }

export async function desktopWindows(computer: Computer): Promise<DesktopWindow[]> {
  const [listed, active] = await Promise.all([
    computer.exec('DISPLAY=:1 wmctrl -l', { timeoutMs: 5000 }),
    computer.exec('DISPLAY=:1 xprop -root _NET_ACTIVE_WINDOW', { timeoutMs: 5000 }),
  ])
  if (listed.code !== 0) throw new Error(listed.stderr.trim() || 'Could not list desktop windows')
  const normalizeId = (value: string | undefined) => value ? `0x${BigInt(value).toString(16)}` : undefined
  const activeId = normalizeId(/0x[0-9a-f]+/i.exec(active.stdout)?.[0])
  return listed.stdout.split('\n').flatMap((line) => {
    const match = /^(0x[0-9a-f]+)\s+\S+\s+\S+\s*(.*)$/i.exec(line.trim())
    return match ? [{ id: match[1]!, title: match[2]!, active: normalizeId(match[1]) === activeId }] : []
  })
}

export class ComputerUseSession {
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly now: () => number

  constructor(
    private readonly computer: DesktopToolComputer,
    private readonly screen: ScreenRecorder,
    private readonly gate: DisplayGate,
    private readonly recorder: TurnEventRecorder,
    private readonly signal?: AbortSignal,
    options: SessionOptions = {},
  ) {
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = options.now ?? Date.now
  }

  private async cursor(): Promise<{ x: number; y: number }> {
    const native = await this.computer.desktopCursor?.()
    if (native) return native
    const result = await this.computer.exec('DISPLAY=:1 xdotool getmouselocation --shell', { timeoutMs: 5000, signal: this.signal })
    const x = /^X=(\d+)$/m.exec(result.stdout)?.[1], y = /^Y=(\d+)$/m.exec(result.stdout)?.[1]
    return { x: Number(x ?? 0), y: Number(y ?? 0) }
  }

  private async capture(message?: string, automatic = false, force = false): Promise<ComputerToolOutput> {
    if (automatic && !this.screen.claimDesktopAutomatic(700, this.now(), force)) return { message: 'action done; call computer_screenshot to observe' }
    const captured = await this.computer.captureScreen({ quality: 60 })
    const cursor = await this.cursor()
    const payload = await this.screen.saveImage(captured.image, captured.mediaType, { source: 'desktop', width: captured.width, height: captured.height })
    return { message, url: payload.url, mediaType: captured.mediaType, width: captured.width, height: captured.height, cursor }
  }

  screenshot(): Promise<ComputerToolOutput> {
    return this.gate.run(this.recorder, this.signal, () => this.capture()).then(({ value }) => value)
  }

  action(action: () => Promise<void>, message: string): Promise<ComputerToolOutput> {
    return this.gate.run(this.recorder, this.signal, async ({ resumed }) => {
      if (resumed) await this.capture(undefined, true, true)
      await action()
      await this.sleep(300)
      return this.capture(message, true)
    }).then(({ value, controlChanged }) => controlChanged
      ? { ...value, message: `${value.message ?? 'action done'}; control changed during this action, call computer_screenshot to observe` }
      : value)
  }

  windows(): Promise<DesktopWindow[]> {
    return this.gate.run(this.recorder, this.signal, async () => (await this.computer.desktopWindows?.()) ?? desktopWindows(this.computer)).then(({ value }) => value)
  }

  input(action: DesktopInputAction): Promise<void> { return this.computer.desktopInput(action) }

  async focus(input: { id?: string; titleContains?: string }): Promise<ComputerToolOutput> {
    return this.action(async () => {
      if (this.computer.focusDesktopWindow && await this.computer.focusDesktopWindow(input) !== false) return
      let id = input.id
      if (id && !/^0x[0-9a-f]+$/i.test(id)) throw new Error('Invalid desktop window id')
      if (!id) {
        const needle = input.titleContains!.toLowerCase()
        id = (await desktopWindows(this.computer)).find((window) => window.title.toLowerCase().includes(needle))?.id
        if (!id) throw new Error(`No window title contains ${input.titleContains}`)
      }
      const result = await this.computer.exec(`DISPLAY=:1 wmctrl -ia ${id}`, { timeoutMs: 5000, signal: this.signal })
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not focus window ${id}`)
    }, `focused ${input.id ?? input.titleContains}`)
  }
}

export async function computerModelOutput(screen: ScreenRecorder, output: ComputerToolOutput) {
  const line = output.url && output.width !== undefined && output.height !== undefined && output.cursor
    ? `screen ${output.width}x${output.height}, cursor at ${output.cursor.x},${output.cursor.y}`
    : undefined
  const text = [line, output.message, output.url ? `screenshot ${output.url}` : undefined].filter(Boolean).join('\n') || 'action done'
  const value: Array<{ type: 'text'; text: string } | { type: 'image-data'; data: string; mediaType: string }> = [{ type: 'text', text }]
  if (output.url) value.push({ type: 'image-data', data: (await screen.readUrl(output.url)).toString('base64'), mediaType: output.mediaType ?? 'image/jpeg' })
  return { type: 'content' as const, value }
}

export function computerTools(session: ComputerUseSession, screen: ScreenRecorder) {
  const safe = async (operation: () => Promise<ComputerToolOutput>) => { try { return await operation() } catch (error) { return failure(error) } }
  const action = (input: DesktopInputAction, message: string) => safe(() => session.action(() => session.input(input), message))
  return {
    computer_screenshot: tool({ description: 'Capture the full shared desktop at native resolution.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.screenshot, execute: () => safe(() => session.screenshot()), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_click: tool({ description: 'Click desktop pixel coordinates.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.click, execute: ({ x, y, button }) => action({ type: 'click', x, y, button }, `clicked at ${x},${y}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_double_click: tool({ description: 'Double-click desktop pixel coordinates.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.doubleClick, execute: ({ x, y }) => action({ type: 'double_click', x, y }, `double-clicked at ${x},${y}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_right_click: tool({ description: 'Right-click desktop pixel coordinates.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.rightClick, execute: ({ x, y }) => action({ type: 'right_click', x, y }, `right-clicked at ${x},${y}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_move: tool({ description: 'Move the desktop pointer without clicking.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.move, execute: ({ x, y }) => action({ type: 'move', x, y }, `moved to ${x},${y}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_drag: tool({ description: 'Drag from one desktop coordinate to another.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.drag, execute: ({ fromX, fromY, toX, toY }) => action({ type: 'drag', fromX, fromY, toX, toY }, `dragged ${fromX},${fromY} to ${toX},${toY}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_type: tool({ description: 'Type text into the focused desktop control.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.type, execute: ({ text }) => action({ type: 'type', text }, `typed ${text.length} characters`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_key: tool({ description: 'Press a desktop key chord such as ctrl+l, Return, or alt+Tab.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.key, execute: ({ key }) => action({ type: 'key', key }, `pressed ${key}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_scroll: tool({ description: 'Scroll at desktop pixel coordinates.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.scroll, execute: ({ x, y, direction, amount = 3 }) => action({ type: 'scroll', x, y, direction, amount }, `scrolled ${direction} at ${x},${y}`), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_wait: tool({ description: 'Wait briefly for the desktop to update.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.wait, execute: ({ seconds }) => safe(() => session.action(() => new Promise((resolve) => setTimeout(resolve, seconds * 1000)), `waited ${seconds} seconds`)), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
    computer_windows: tool({ description: 'List desktop windows with ids, titles, and active state.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.windows, execute: async () => { try { return await session.windows() } catch (error) { return { error: failure(error).message } } } }),
    computer_focus_window: tool({ description: 'Focus a desktop window by id or title substring.', contextSchema: toolContextSchema, inputSchema: computerToolSchemas.focusWindow, execute: (input) => safe(() => session.focus(input)), toModelOutput: ({ output }) => computerModelOutput(screen, output) }),
  }
}
