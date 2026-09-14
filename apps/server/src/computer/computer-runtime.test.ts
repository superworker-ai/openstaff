import { MockLanguageModelV3 } from 'ai/test'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import type { DesktopInputAction, JsonValue } from '@openstaff/shared'
import { AgentRuntime, stripInlineFileData } from '../agent/runtime.js'
import { BrowserService } from '../browser/service.js'
import { bots, turnEvents, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { ScreenRecorder } from './screen-recorder.js'

const call = (name: string, input: unknown, toolCallId = name) => mockStream([
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId, toolName: name, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
])

it('runs screenshot then click with desktop screenshot events and image model output', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  const captureScreen = vi.fn(async () => ({ image: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]), mediaType: 'image/jpeg' as const, width: 1280, height: 800 }))
  const desktopInput = vi.fn(async (_action: DesktopInputAction) => undefined)
  const computer = Object.assign(f.computer, {
    desktopSupported: async () => true,
    captureScreen,
    desktopInput,
    exec: vi.fn(async (command: string) => command.includes('getmouselocation')
      ? { stdout: 'X=10\nY=20\n', stderr: '', code: 0 }
      : { stdout: '', stderr: '', code: 0 }),
  })
  let sawClickImage = false
  let step = 0
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    step += 1
    if (step === 1) return call('computer_screenshot', {})
    if (step === 2) return call('computer_click', { x: 10, y: 20 })
    {
      const results = options.prompt.flatMap((message) => message.role === 'tool' ? message.content : []).filter((part) => part.type === 'tool-result')
      const click = results.find((part) => part.toolName === 'computer_click')
      sawClickImage = JSON.stringify(click).includes('image/jpeg')
      return textStream('Desktop action complete.')
    }
  } })
  try {
    await f.db.update(bots).set({ approvalPolicy: 'auto' }).where(eq(bots.id, f.botId))
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Use the desktop' })
    const turn = (await f.db.select().from(turns).where(eq(turns.id, posted.turns[0]!.id)))[0]!
    const runtime = new AgentRuntime({ ...f, computer, browser, contextMessages: 60, modelResolver: () => model })
    await expect(runtime.run(turn)).resolves.toMatchObject({ kind: 'done', text: 'Desktop action complete.' })
    const screenshots = (await f.db.select().from(turnEvents)).filter((event) => event.type === 'screenshot')
    expect(screenshots).toHaveLength(2)
    expect(screenshots.map((event) => event.payload.source)).toEqual(['desktop', 'desktop'])
    expect(screenshots.map((event) => event.payload.url)).toEqual([`/api/screens/${turn.id}/1.jpg`, `/api/screens/${turn.id}/2.jpg`])
    expect(sawClickImage).toBe(true)
    expect(JSON.stringify((await f.db.select().from(turnEvents)).filter((event) => event.type === 'tool-result'))).not.toContain('file-data')
  } finally { await browser.close(); await f.close() }
})

it.each([false, true])('bounds model context across five clicks (resumed messages: %s)', async (resumed) => {
  vi.stubEnv('COMPUTER_SCREENSHOT_CONTEXT', '3')
  const f = await fixture(), browser = new BrowserService(f.directory)
  // Throttle behavior is tested separately; each action must produce an image here.
  const automatic = vi.spyOn(ScreenRecorder.prototype, 'claimDesktopAutomatic').mockReturnValue(true)
  const computer = Object.assign(f.computer, {
    desktopSupported: async () => true,
    captureScreen: vi.fn(async () => ({ image: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]), mediaType: 'image/jpeg' as const, width: 1280, height: 800 })),
    desktopInput: vi.fn(async () => undefined),
    exec: vi.fn(async () => ({ stdout: 'X=10\nY=20\n', stderr: '', code: 0 })),
  })
  const imageCounts: number[] = []
  let finalPrompt = ''
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    const prompt = JSON.stringify(options.prompt)
    imageCounts.push((prompt.match(/"mediaType":"image\/jpeg"/g) ?? []).length)
    if (imageCounts.length <= 5) return call('computer_click', { x: 10, y: 20 }, `click-${imageCounts.length}`)
    finalPrompt = prompt
    return textStream('Five clicks complete.')
  } })
  try {
    await f.db.update(bots).set({ approvalPolicy: 'auto' }).where(eq(bots.id, f.botId))
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Click five times' })
    const turn = (await f.db.select().from(turns).where(eq(turns.id, posted.turns[0]!.id)))[0]!
    if (resumed) {
      // Older saved turns may still contain inline images when resumed after approval.
      turn.modelMessages = [{ role: 'user', content: 'Continue clicking' }, ...[1, 2, 3, 4, 5].flatMap((number): JsonValue[] => [
        { role: 'assistant', content: [{ type: 'tool-call', toolName: 'computer_screenshot', toolCallId: `saved-${number}`, input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', toolName: 'computer_screenshot', toolCallId: `saved-${number}`, output: {
          type: 'content', value: [
            { type: 'text', text: `screenshot /api/screens/turn_SAVED/${number}.jpg` },
            { type: 'file-data', data: 'aW1hZ2U=', mediaType: 'image/jpeg' },
          ],
        } }] },
      ])]
    }
    const runtime = new AgentRuntime({ ...f, computer, browser, contextMessages: 60, modelResolver: () => model })
    await expect(runtime.run(turn)).resolves.toMatchObject({ kind: 'done', text: 'Five clicks complete.' })
    expect(imageCounts).toEqual(resumed ? [3, 3, 3, 3, 3, 3] : [0, 1, 2, 3, 3, 3])
    expect(computer.captureScreen).toHaveBeenCalledTimes(5)
    expect(finalPrompt).toContain(`[earlier screenshot /api/screens/${turn.id}/1.jpg]`)
    expect(finalPrompt).toContain(`[earlier screenshot /api/screens/${turn.id}/2.jpg]`)
  } finally { automatic.mockRestore(); vi.unstubAllEnvs(); await browser.close(); await f.close() }
})

it('replaces inline screenshot bytes before model messages are persisted', () => {
  const input = [{ role: 'tool', content: [{ type: 'tool-result', output: { type: 'content', value: [
    { type: 'text', text: 'screen 1280x800\nscreenshot /api/screens/turn_TEST/2.jpg' },
    { type: 'file-data', data: 'large-base64', mediaType: 'image/jpeg' },
  ] } }] }]
  const output = stripInlineFileData(input)
  expect(JSON.stringify(output)).not.toContain('large-base64')
  expect(output).toEqual([{ role: 'tool', content: [{ type: 'tool-result', output: { type: 'content', value: [
    { type: 'text', text: 'screen 1280x800\nscreenshot /api/screens/turn_TEST/2.jpg' },
    { type: 'text', text: '[screenshot /api/screens/turn_TEST/2.jpg]' },
  ] } }] }])
})
