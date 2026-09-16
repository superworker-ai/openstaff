import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@openstaff/shared'
import { MissingApiKeyError, opencodeHeaders, opencodeTarget, resolveModel } from './models.js'

function keys(values: Partial<Record<Provider, string>>) {
  return { get: (provider: Provider) => values[provider] }
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('OpenCode model resolution', () => {
  it('selects the Zen and Go endpoints for OpenAI-compatible models', () => {
    expect(opencodeTarget('opencode', 'kimi-k3')).toEqual({ baseURL: 'https://opencode.ai/zen/v1', sdk: 'openai-compatible' })
    expect(opencodeTarget('opencode-go', 'kimi-k3')).toEqual({ baseURL: 'https://opencode.ai/zen/go/v1', sdk: 'openai-compatible' })
    expect(resolveModel('opencode/kimi-k3', keys({ opencode: 'key' }))).toMatchObject({ provider: 'opencode.chat', modelId: 'kimi-k3' })
    expect(resolveModel('opencode-go/kimi-k3', keys({ opencode: 'key' }))).toMatchObject({ provider: 'opencode.chat', modelId: 'kimi-k3' })
  })

  it('selects the SDK package from the model id', () => {
    expect(opencodeTarget('opencode', 'claude-sonnet-4-6').sdk).toBe('anthropic')
    expect(resolveModel('opencode/claude-sonnet-4-6', keys({ opencode: 'key' }))).toMatchObject({ provider: 'anthropic.messages', modelId: 'claude-sonnet-4-6' })
    expect(opencodeTarget('opencode-go', 'gpt-5.6-luna').sdk).toBe('openai')
    expect(resolveModel('opencode-go/gpt-5.6-luna', keys({ opencode: 'key' }))).toMatchObject({ provider: 'openai.responses', modelId: 'gpt-5.6-luna' })
  })

  it('reports a missing OpenCode key under the saved provider name', () => {
    vi.stubEnv('OPENCODE_API_KEY', '')
    let error: unknown
    try { resolveModel('opencode/kimi-k3', keys({})) } catch (reason) { error = reason }
    expect(error).toBeInstanceOf(MissingApiKeyError)
    expect(error).toMatchObject({ provider: 'opencode' })
  })

  it('identifies the client and the conversation to OpenCode', () => {
    expect(opencodeHeaders('bot_a:room_b')).toEqual({ 'user-agent': expect.stringMatching(/^openstaff\/\d/), 'x-opencode-session': 'bot_a:room_b' })
    expect(opencodeHeaders()['x-opencode-session']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sends the session id and user agent on the wire for Go requests', async () => {
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const body = { id: 'r', object: 'chat.completion', created: 0, model: 'kimi-k3', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const result = await generateText({ model: resolveModel('opencode-go/kimi-k3', keys({ opencode: 'secret' }), { sessionId: 'bot_a:room_b' }), prompt: 'hi' })
    expect(result.text).toBe('ok')
    const request = requests[0]!
    expect(request.url).toBe('https://opencode.ai/zen/go/v1/chat/completions')
    expect(request.headers.get('x-opencode-session')).toBe('bot_a:room_b')
    expect(request.headers.get('user-agent')).toMatch(/^openstaff\//)
    expect(request.headers.get('authorization')).toBe('Bearer secret')
  })

  it('bypasses AI Gateway only for OpenCode prefixes', () => {
    const store = keys({ opencode: 'opencode-key', aiGateway: 'gateway-key' })
    expect(resolveModel('opencode-go/x', store)).toMatchObject({ provider: 'opencode.chat', modelId: 'x' })
    expect(resolveModel('xai/grok-4.6', store)).toMatchObject({ provider: 'gateway', modelId: 'xai/grok-4.6' })
  })
})
