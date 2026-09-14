import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage } from '@ai-sdk/provider'

export const mockUsage: LanguageModelV3Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

export function mockStream(parts: LanguageModelV3StreamPart[]): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

export function textStream(text: string): LanguageModelV3StreamResult {
  return mockStream([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: mockUsage },
  ])
}

export function objectResult(value: unknown): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: mockUsage,
    warnings: [],
  }
}
