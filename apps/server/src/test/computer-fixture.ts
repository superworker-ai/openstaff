import { vi } from 'vitest'
import { z } from 'zod'
import type { ComputerStatus } from '@openstaff/shared'
import { fixture } from './fixture.js'
import { ComputerManager } from '../computer/manager.js'
import { computerProvider, registerComputerProvider } from '../computer/registry.js'
import type { ComputerProvider } from '../computer/provider.js'
import type { ManagedComputer } from '../computer/types.js'
import { Secrets } from '../secrets.js'
import { messages, turns } from '../db/schema.js'
import { DurableWorkspace } from '../storage/durable.js'
import { FsWorkspaceStore } from '../storage/fs.js'

export async function computerFixture() {
  const f = await fixture(), original = computerProvider('e2b')
  let state: ComputerStatus['status'] = 'ready'
  const resume = () => { state = 'ready' }
  const managed: ManagedComputer = {
    root: '/workspace',
    exec: vi.fn(async () => { resume(); return { stdout: 'ok', stderr: '', code: 0 } }),
    readFile: vi.fn(async () => { resume(); return 'hello' }),
    readFileBytes: vi.fn(async (key: string) => { resume(); return new Uint8Array(Buffer.from(key.startsWith('.openstaff/reconcile.') ? '[]' : 'hello')) }),
    writeFile: vi.fn(async () => { resume() }), mkdir: vi.fn(async () => { resume() }),
    list: vi.fn(async () => []), stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 5 })),
    status: vi.fn(async () => ({ provider: 'e2b' as const, status: state, lockedByEnv: false })),
    restart: vi.fn(async () => { resume() }), stop: vi.fn(async () => { state = 'paused' }),
    destroy: vi.fn(async () => { state = 'stopped' }), close: vi.fn(async () => {}),
  }
  const open = vi.fn<ComputerProvider['open']>(async (input) => {
    await input.persist({ externalId: input.instance?.externalId ?? 'stub-instance', status: 'ready' })
    return managed
  })
  const validate = vi.fn<ComputerProvider['validateCredentials']>(async () => {})
  const provider: ComputerProvider = { ...original, capabilities: { ...original.capabilities, hostFiles: false }, credentialSchema: z.object({ apiKey: z.string().min(1) }), open, validateCredentials: validate }
  registerComputerProvider(provider)
  const durable = new DurableWorkspace(new FsWorkspaceStore(f.directory), f.db)
  const manager = new ComputerManager(f.directory, f.db, new Secrets(Buffer.alloc(32, 1)), durable)
  async function busy(status: 'running' | 'waiting_approval' = 'running') {
    await f.db.insert(messages).values({ id: 'msg_busy', roomId: f.roomId, seq: 1, authorKind: 'user', authorId: f.userId, text: 'test', mentions: [], attachments: [], createdAt: new Date().toISOString() })
    await f.db.insert(turns).values({ id: 'turn_busy', roomId: f.roomId, botId: f.botId, triggerMessageId: 'msg_busy', status, replyMode: 'direct', model: 'xai/test', modelMessages: [] })
  }
  return { ...f, manager, managed, provider, open, validate, durable, busy, cleanup: async () => { await manager.close(); registerComputerProvider(original); await f.close() } }
}
