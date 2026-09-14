import type { ModelMessage } from 'ai'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function screenshotUrl(parts: unknown[]): string | undefined {
  for (const part of parts) {
    if (record(part) && typeof part.text === 'string') {
      const url = /\/api\/screens\/[^/\s]+\/[1-9]\d*\.(?:jpg|png)/.exec(part.text)?.[0]
      if (url) return url
    }
  }
  return undefined
}

function inlineImage(value: unknown): boolean {
  return record(value) && value.type === 'file-data' && typeof value.mediaType === 'string' && value.mediaType.startsWith('image/')
}

function containsImage(value: unknown): boolean {
  if (inlineImage(value)) return true
  if (Array.isArray(value)) return value.some(containsImage)
  return record(value) && Object.values(value).some(containsImage)
}

function replaceFileData(value: unknown, label: string, imagesOnly: boolean, url?: string): unknown {
  if (Array.isArray(value)) {
    const siblingUrl = screenshotUrl(value) ?? url
    return value.map((part) => replaceFileData(part, label, imagesOnly, siblingUrl))
  }
  if (!record(value)) return value
  if (value.type === 'file-data' && (!imagesOnly || inlineImage(value))) {
    return { type: 'text', text: `[${label} ${url ?? 'unavailable'}]` }
  }
  return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, replaceFileData(part, label, imagesOnly, url)]))
}

export function stripInlineFileData(value: unknown): unknown {
  return replaceFileData(value, 'screenshot', false)
}

export function screenshotContextLimit(value = process.env.COMPUTER_SCREENSHOT_CONTEXT): number {
  const limit = value?.trim() ? Number(value) : NaN
  return Number.isSafeInteger(limit) && limit >= 0 ? limit : 3
}

/** Keep the newest image-bearing tool results without mutating the conversation. */
export function pruneScreenshotContext(messages: ModelMessage[], limit = screenshotContextLimit()): ModelMessage[] {
  let remaining = limit
  return messages.slice().reverse().map((message): ModelMessage => {
    if (message.role !== 'tool') return message
    const content = message.content.slice().reverse().map((part) => {
      if (part.type !== 'tool-result' || !containsImage(part.output)) return part
      if (remaining-- > 0) return part
      return { ...part, output: replaceFileData(part.output, 'earlier screenshot', true) as typeof part.output }
    }).reverse()
    return { ...message, content }
  }).reverse()
}
