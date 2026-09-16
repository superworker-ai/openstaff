import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { KeyStore } from '../secrets.js'

/** Per-call context. `sessionId` is a stable id for one conversation; OpenCode Go routes and prompt-caches by it. */
export type ResolveOptions = { sessionId?: string }
export type ModelResolver = (id: string, options?: ResolveOptions) => LanguageModel

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }
export const OPENSTAFF_USER_AGENT = `openstaff/${version}`

/** OpenCode Go rejects requests without `x-opencode-session` and asks clients to identify themselves (https://opencode.ai/docs/go/#where-can-i-use-it). */
export function opencodeHeaders(sessionId?: string): Record<string, string> {
  return { 'user-agent': OPENSTAFF_USER_AGENT, 'x-opencode-session': sessionId || randomUUID() }
}

/** The AI SDK replaces `user-agent` after merging provider headers, so both headers are stamped on the request itself. */
function opencodeFetch(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init)
    for (const [name, value] of Object.entries(headers)) request.headers.set(name, value)
    return globalThis.fetch(request)
  }
}

export class MissingApiKeyError extends Error {
  constructor(readonly provider: string) {
    super(`no API key configured for ${provider}`)
    this.name = 'MissingApiKeyError'
  }
}

function splitModelId(id: string): [string, string] {
  const separator = id.indexOf('/')
  if (separator <= 0 || separator === id.length - 1) throw new Error(`Invalid model id: ${id}`)
  return [id.slice(0, separator), id.slice(separator + 1)]
}

export function opencodeTarget(provider: 'opencode' | 'opencode-go', model: string): { baseURL: string; sdk: 'anthropic' | 'openai' | 'openai-compatible' } {
  const baseURL = provider === 'opencode-go' ? 'https://opencode.ai/zen/go/v1' : 'https://opencode.ai/zen/v1'
  const sdk = model.startsWith('claude-') ? 'anthropic' : model.startsWith('gpt-') ? 'openai' : 'openai-compatible'
  return { baseURL, sdk }
}

export function resolveModel(id: string, keys?: Pick<KeyStore, 'get'>, options?: ResolveOptions): LanguageModel {
  const [provider, model] = splitModelId(id)
  if (provider === 'opencode' || provider === 'opencode-go') {
    const apiKey = keys?.get('opencode') ?? process.env.OPENCODE_API_KEY
    if (!apiKey) throw new MissingApiKeyError('opencode')
    const target = opencodeTarget(provider, model)
    const fetch = opencodeFetch(opencodeHeaders(options?.sessionId))
    if (target.sdk === 'anthropic') return createAnthropic({ apiKey, baseURL: target.baseURL, fetch })(model as never)
    if (target.sdk === 'openai') return createOpenAI({ apiKey, baseURL: target.baseURL, fetch })(model as never)
    return createOpenAICompatible({ name: 'opencode', apiKey, baseURL: target.baseURL, fetch }).chatModel(model)
  }
  const gatewayKey = keys ? keys.get('aiGateway') : process.env.AI_GATEWAY_API_KEY
  if (gatewayKey) {
    const gateway = createGateway({ apiKey: gatewayKey })
    return gateway(id)
  }
  if (provider === 'xai') {
    const apiKey = keys ? keys.get('xai') : process.env.XAI_API_KEY
    if (!apiKey) throw new MissingApiKeyError(provider)
    return createXai({ apiKey })(model as never)
  }
  if (provider === 'anthropic') {
    const apiKey = keys ? keys.get('anthropic') : process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new MissingApiKeyError(provider)
    return createAnthropic({ apiKey })(model as never)
  }
  if (provider === 'openai') {
    const apiKey = keys ? keys.get('openai') : process.env.OPENAI_API_KEY
    if (!apiKey) throw new MissingApiKeyError(provider)
    return createOpenAI({ apiKey })(model as never)
  }
  throw new Error(`Unsupported model provider: ${provider}`)
}
