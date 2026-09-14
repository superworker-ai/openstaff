import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { WorkspaceStore } from './types.js'

export function workspaceStoreContract(store: () => WorkspaceStore) {
  it('puts, gets, lists, stats, and deletes objects with prefix isolation', async () => {
    const value = new Uint8Array([0, 1, 2, 128, 255])
    await store().put('bots/alpha/MEMORY.md', value, { contentType: 'text/markdown' })
    await store().put('skills/example/SKILL.md', new Uint8Array(Buffer.from('skill')))
    expect(await store().get('bots/alpha/MEMORY.md')).toEqual(value)
    expect(await store().stat('bots/alpha/MEMORY.md')).toMatchObject({ size: 5 })
    expect((await store().list('bots/')).map((item) => item.key)).toEqual(['bots/alpha/MEMORY.md'])
    await store().delete('bots/alpha/MEMORY.md')
    expect(await store().stat('bots/alpha/MEMORY.md')).toBeNull()
    expect((await store().list('skills/')).map((item) => item.key)).toEqual(['skills/example/SKILL.md'])
  })

  it('round-trips a multipart-sized 20 MB object', async () => {
    const value = new Uint8Array(20 * 1024 ** 2)
    for (let index = 0; index < value.length; index += 4096) value[index] = index % 251
    await store().put('uploads/room/large.bin', value)
    const restored = await store().get('uploads/room/large.bin')
    expect(restored.byteLength).toBe(value.byteLength)
    expect(createHash('sha256').update(restored).digest('hex')).toBe(createHash('sha256').update(value).digest('hex'))
  }, 60_000)

  it.each(['../escape', '/absolute', 'bots/../escape', 'bots\\escape'])('rejects an unsafe key: %s', async (key) => {
    await expect(store().put(key, new Uint8Array())).rejects.toThrow('Invalid workspace key')
    await expect(store().get(key)).rejects.toThrow('Invalid workspace key')
    await expect(store().delete(key)).rejects.toThrow('Invalid workspace key')
    await expect(store().stat(key)).rejects.toThrow('Invalid workspace key')
    await expect(store().list(key)).rejects.toThrow('Invalid workspace key')
  })
}
