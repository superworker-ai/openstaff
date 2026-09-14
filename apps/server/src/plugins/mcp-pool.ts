import type { MCPClient } from '@ai-sdk/mcp'

export class MCPClientPool {
  private readonly entries = new Map<string, Promise<MCPClient>>()
  async acquire(key: string, create: (invalidate: () => void) => Promise<MCPClient>): Promise<MCPClient> {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = create(() => { if (this.entries.get(key) === entry) void this.invalidate(key) })
      this.entries.set(key, entry)
    }
    try {
      const client = await entry
      if (this.entries.get(key) !== entry) throw new Error('MCP pool was rebuilt')
      return client
    } catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); throw error }
  }
  async invalidate(key: string): Promise<void> {
    const entry = this.entries.get(key)
    this.entries.delete(key)
    await (await entry?.catch(() => undefined))?.close().catch(() => undefined)
  }
  async close(): Promise<void> { await Promise.all([...this.entries.keys()].map((key) => this.invalidate(key))) }
}
