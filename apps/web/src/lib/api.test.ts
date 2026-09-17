import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, api } from './api.js'

afterEach(() => vi.restoreAllMocks())

it('attaches a response error code to the thrown error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Plan reached', code: 'plan_limit' }), { status: 402, headers: { 'content-type': 'application/json' } })))
  const error = await api('/api/test').catch((reason) => reason)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ message: 'Plan reached', code: 'plan_limit' })
})
