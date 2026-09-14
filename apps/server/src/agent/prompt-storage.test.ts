import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { DurableWorkspace } from '../storage/durable.js'
import type { WorkspaceStore } from '../storage/types.js'
import { buildTurnPrompt, skillsIndex } from './prompt.js'
import { messages } from '../db/schema.js'

it('builds unchanged prompts without store round trips and refreshes cached skill descriptions after writes', async () => {
  const f = await fixture(), contents = new Map<string, Uint8Array>()
  const store: WorkspaceStore = {
    kind: 'fs',
    put: async (key, data) => { contents.set(key, data) },
    get: async (key) => { const data = contents.get(key); if (!data) throw new Error('Missing fixture'); return data },
    list: async () => [],
    stat: async (key) => contents.has(key) ? { size: contents.get(key)!.byteLength } : null,
    delete: async (key) => { contents.delete(key) },
    healthy: async () => {},
  }
  const durable = new DurableWorkspace(store, f.db)
  try {
    await durable.put('bots/drake/MEMORY.md', Buffer.from('remember me'))
    await durable.put('skills/research/SKILL.md', Buffer.from('description: Research sources\nbody'))
    await f.db.insert(messages).values({ id: 'msg-storage', roomId: f.roomId, seq: 1, authorKind: 'user', authorId: f.userId, text: 'hello', mentions: [], attachments: [], createdAt: new Date().toISOString() })
    const get = vi.spyOn(store, 'get'), list = vi.spyOn(store, 'list'), stat = vi.spyOn(store, 'stat')
    const turn = { roomId: f.roomId, botId: f.botId, triggerMessageId: 'msg-storage' }
    for (let n = 0; n < 2; n++) {
      const prompt = await buildTurnPrompt(f.db, f.computer, turn, 60, undefined, durable)
      expect(prompt.instructions).toContain('research: Research sources')
      expect(prompt.instructions).toContain('remember me')
    }
    expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled()
    await durable.put('skills/research/SKILL.md', Buffer.from('description: Updated description'))
    expect(await skillsIndex(f.computer, durable)).toBe('research: Updated description')
    // The description persists across server restarts, with no warm-up object reads.
    expect(await skillsIndex(f.computer, new DurableWorkspace(store, f.db))).toBe('research: Updated description')
    expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled()
  } finally { await f.close() }
})
