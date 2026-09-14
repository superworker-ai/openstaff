import { createMCPClient, type MCPTransport } from '@ai-sdk/mcp'
import { expect, it, vi } from 'vitest'
import { MCPClientPool } from './mcp-pool.js'

class FakeTransport implements MCPTransport {
  onmessage?: MCPTransport['onmessage']
  close = vi.fn(async () => undefined)
  async start() {}
  async send(message: Parameters<MCPTransport['send']>[0]) {
    if (!('id' in message) || !('method' in message)) return
    const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } : { tools: [] }
    this.onmessage?.({ jsonrpc: '2.0', id: message.id, result })
  }
}
it('reuses one transport across two turns and restarts after invalidation', async () => {
  const pool = new MCPClientPool(), transports: FakeTransport[] = []
  const create = vi.fn(async () => { const transport = new FakeTransport(); transports.push(transport); return createMCPClient({ transport }) })
  try {
    const first = await pool.acquire('plugin/server', create)
    await first.listTools()
    const second = await pool.acquire('plugin/server', create)
    await second.listTools()
    expect(second).toBe(first); expect(create).toHaveBeenCalledTimes(1)
    expect(transports[0]!.close).not.toHaveBeenCalled()
    await pool.invalidate('plugin/server')
    expect(transports[0]!.close).toHaveBeenCalledOnce()
    expect(await pool.acquire('plugin/server', create)).not.toBe(first)
  } finally { await pool.close() }
  expect(transports[1]!.close).toHaveBeenCalledOnce()
})
