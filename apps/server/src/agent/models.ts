import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import type { KeyStore } from '../secrets.js'

export type ModelResolver = (id: string) => LanguageModel

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

export function resolveModel(id: string, keys?: Pick<KeyStore, 'get'>): LanguageModel {
  const gatewayKey = keys ? keys.get('aiGateway') : process.env.AI_GATEWAY_API_KEY
  if (gatewayKey) {
    const gateway = createGateway({ apiKey: gatewayKey })
    return gateway(id)
  }
  const [provider, model] = splitModelId(id)
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
