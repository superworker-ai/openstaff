import type { ModelMessage } from 'ai'
import { afterEach, expect, it, vi } from 'vitest'
import { pruneScreenshotContext, screenshotContextLimit, stripInlineFileData } from './screenshot-context.js'

const image = { type: 'file-data' as const, data: 'jpeg-bytes', mediaType: 'image/jpeg' }
const pdf = { type: 'file-data' as const, data: 'pdf-bytes', mediaType: 'application/pdf' }
const text = (value: string) => ({ type: 'text' as const, text: value })
const url = (number: number) => `/api/screens/turn_TEST/${number}.jpg`
const result = (number: number) => ({
  type: 'tool-result' as const, toolName: 'computer_click', toolCallId: `click-${number}`,
  output: { type: 'content' as const, value: [text(`screen 1280x800\nscreenshot ${url(number)}`), image] },
})

afterEach(() => vi.unstubAllEnvs())

it('keeps the last three image-bearing results across messages and replaces older images with their URLs', () => {
  vi.stubEnv('COMPUTER_SCREENSHOT_CONTEXT', '')
  const messages: ModelMessage[] = [
    { role: 'tool', content: [result(1), result(2)] },
    { role: 'tool', content: [result(3), result(4), result(5)] },
  ]
  const original = structuredClone(messages)
  expect(pruneScreenshotContext(messages)).toEqual([
    { role: 'tool', content: [1, 2].map((number) => ({ ...result(number), output: {
      type: 'content', value: [text(`screen 1280x800\nscreenshot ${url(number)}`), text(`[earlier screenshot ${url(number)}]`)],
    } })) },
    messages[1],
  ])
  expect(messages).toEqual(original)
})

it('leaves user, assistant, and non-image tool results untouched and does not count them toward the limit', () => {
  const user: ModelMessage = { role: 'user', content: [{ type: 'image', image: 'user-image', mediaType: 'image/jpeg' }] }
  const assistant: ModelMessage = { role: 'assistant', content: [{ type: 'file', data: 'assistant-image', mediaType: 'image/jpeg' }] }
  const plain = { ...result(6), output: { type: 'text' as const, value: 'action done' } }
  const document = { ...result(7), output: { type: 'content' as const, value: [pdf] } }
  const messages: ModelMessage[] = [user, assistant, { role: 'tool', content: [result(1), plain, document] }]
  const output = pruneScreenshotContext(messages, 1)
  expect(output).toEqual(messages)
  expect(output[0]).toBe(user)
  expect(output[1]).toBe(assistant)
  expect(output[2]).toMatchObject({ content: [result(1), plain, document] })
})

it('handles nested content arrays, counts results rather than images, and preserves non-image files', () => {
  const nested = { type: 'content', value: [text(`screenshot ${url(1)}`), [image, { content: [image, pdf] }]] }
  const messages = [{ role: 'tool', content: [{ ...result(1), output: nested }, result(2)] }] as unknown as ModelMessage[]
  expect(pruneScreenshotContext(messages, 2)).toEqual(messages)
  expect(pruneScreenshotContext(messages, 1)).toEqual([{ role: 'tool', content: [
    { ...result(1), output: { type: 'content', value: [text(`screenshot ${url(1)}`), [
      text(`[earlier screenshot ${url(1)}]`), { content: [text(`[earlier screenshot ${url(1)}]`), pdf] },
    ]] } }, result(2),
  ] }])
  expect(stripInlineFileData(nested)).toEqual({ type: 'content', value: [text(`screenshot ${url(1)}`), [
    text(`[screenshot ${url(1)}]`), { content: [text(`[screenshot ${url(1)}]`), text(`[screenshot ${url(1)}]`)] },
  ]] })
})

it('handles missing URLs and a zero-image budget', () => {
  const messages: ModelMessage[] = [{ role: 'tool', content: [{ ...result(1), output: { type: 'content', value: [image] } }] }]
  expect(pruneScreenshotContext(messages, 0)).toEqual([{ role: 'tool', content: [
    { ...result(1), output: { type: 'content', value: [text('[earlier screenshot unavailable]')] } },
  ] }])
})

it.each(['', 'invalid', '-1', '1.5', 'Infinity', '9007199254740992'])('defaults an invalid context limit %j to three', (value) => {
  expect(screenshotContextLimit(value)).toBe(3)
})

it.each([0, 1, 5])('reads a configured context limit of %i', (limit) => {
  vi.stubEnv('COMPUTER_SCREENSHOT_CONTEXT', String(limit))
  expect(screenshotContextLimit()).toBe(limit)
  const messages: ModelMessage[] = [{ role: 'tool', content: [result(1), result(2), result(3), result(4), result(5)] }]
  expect(JSON.stringify(pruneScreenshotContext(messages)).match(/jpeg-bytes/g) ?? []).toHaveLength(limit)
})
