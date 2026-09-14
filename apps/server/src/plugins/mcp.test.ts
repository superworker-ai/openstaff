import { expect, it, vi } from 'vitest'
import { createMCPClient } from '@ai-sdk/mcp'
import type { LoadedPlugin } from './loader.js'
import { openPluginTools } from './mcp.js'

vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: vi.fn() }))

it('retains readOnly hints, skips unavailable servers, and closes every successful client', async () => {
  const close = vi.fn(async () => undefined)
  const client = { close, listTools: async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }, { name: 'write', inputSchema: { type: 'object' } }] }), toolsFromDefinitions: () => ({ read: { inputSchema: {} }, write: { inputSchema: {} } }) }
  vi.mocked(createMCPClient).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(client as unknown as Awaited<ReturnType<typeof createMCPClient>>)
  const plugin: LoadedPlugin = { root: '/unused', manifest: { name: 'sample' }, skills: [], agents: [], rules: [], hooks: null, missingVariables: [], servers: { offline: { type: 'http', url: 'https://offline.invalid', headers: {} }, working: { type: 'sse', url: 'https://working.invalid', headers: {} } } }
  const session = await openPluginTools([plugin])
  try {
    expect(Object.keys(session.tools)).toEqual(['sample__read', 'sample__write'])
    expect([...session.readOnly]).toEqual(['sample__read'])
  } finally { await session.close() }
  expect(close).toHaveBeenCalledOnce()
})
