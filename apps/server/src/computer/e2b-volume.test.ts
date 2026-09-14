import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Sandbox, Volume } from 'e2b'
import { e2bProvider } from './e2b.js'
import type { ComputerInstanceRecord } from './provider.js'
import type { ManagedComputer } from './types.js'
import { fixture } from '../test/fixture.js'
import { DurableWorkspace } from '../storage/durable.js'
import { FsWorkspaceStore } from '../storage/fs.js'

describe.skipIf(process.env.E2B_TESTS !== '1')('E2B native workspace volume', () => {
  const apiKey = process.env.E2B_API_KEY ?? ''
  const instanceId = `cmp-live-${crypto.randomUUID()}`
  const sandboxIds = new Set<string>()
  let record: ComputerInstanceRecord | null = null
  let computer: ManagedComputer | undefined
  let f: Awaited<ReturnType<typeof fixture>>
  let durable: DurableWorkspace

  const persist = async (patch: Partial<ComputerInstanceRecord> & Pick<ComputerInstanceRecord, 'externalId' | 'status'>) => {
    const now = new Date().toISOString()
    record = {
      id: instanceId,
      provider: 'e2b',
      externalId: patch.externalId,
      status: patch.status,
      createdAt: record?.createdAt ?? now,
      lastSeenAt: now,
      metadata: { ...(record?.metadata ?? {}), ...(patch.metadata ?? {}) },
    }
    sandboxIds.add(patch.externalId)
  }

  beforeAll(async () => {
    if (!apiKey) throw new Error('E2B_TESTS requires E2B_API_KEY')
    f = await fixture()
    durable = new DurableWorkspace(new FsWorkspaceStore(f.computer.root), f.db)
    const create = Volume.create.bind(Volume)
    vi.spyOn(Volume, 'create').mockImplementation(async (name, opts) => {
      try { return await create(name, opts) }
      catch (error) {
        // Emit only this known, credential-free SDK response, never arbitrary vendor text.
        if (error instanceof Error && error.message === '403: use of volumes is not enabled') console.log(`E2B Volume.create: ${error.message}`)
        throw error
      }
    })
  })
  afterAll(async () => {
    try {
    await computer?.destroy().catch(() => undefined)
    for (const id of sandboxIds) await Sandbox.kill(id, { apiKey }).catch(() => undefined)
    const volumeId = typeof record?.metadata.e2bVolumeId === 'string' ? record.metadata.e2bVolumeId : undefined
    if (volumeId) await Volume.destroy(volumeId, { apiKey }).catch(() => undefined)
    const sandboxes = Sandbox.list({ apiKey })
    const remainingSandboxes: string[] = []
    do { remainingSandboxes.push(...(await sandboxes.nextItems()).map((item) => item.sandboxId)) } while (sandboxes.hasNext)
    expect(remainingSandboxes.filter((id) => sandboxIds.has(id))).toEqual([])
    const volumeName = typeof record?.metadata.e2bVolumeName === 'string' ? record.metadata.e2bVolumeName : undefined
    const volumes = await Volume.list({ apiKey })
    expect(volumes.filter((item) => item.volumeId === volumeId || item.name === volumeName)).toEqual([])
    console.log(`E2B cleanup confirmed: ${sandboxIds.size} sandbox reference(s), ${volumeId ? 'volume absent' : 'no volume allocated'}`)
    } finally { vi.restoreAllMocks(); await f?.close() }
  }, 120_000)

  it('preserves /workspace with a volume or proves the sync-only recreation fallback', async () => {
    computer = await e2bProvider.open({ credentials: { apiKey }, workspaceRoot: '', instanceId, instance: record, persist })
    const attachment = { hostFiles: false, root: '/workspace' }
    await computer.writeFile('bots/live/MEMORY.md', 'restored by durable storage')
    const exec = vi.spyOn(computer, 'exec')
    expect(await durable.reconcile(computer, attachment, new Set())).toMatchObject({ uploaded: 1, skipped: 0 })
    expect((await exec.mock.results[0]!.value).stdout).toContain('hashed=1')
    exec.mockClear()
    expect(await durable.reconcile(computer, attachment, new Set())).toMatchObject({ uploaded: 0, skipped: 0 })
    expect((await exec.mock.results[0]!.value).stdout).toContain('hashed=0')
    console.log('E2B inventory verified: first uploaded=1, hashed=1; unchanged uploaded=0, hashed=0')
    if (!computer.runtimeCapabilities?.volume) {
      expect(record?.metadata.e2bVolumeUnavailable).toBe(true)
      await computer.writeFile('/workspace/keep.txt', 'ephemeral without volume')
      await Sandbox.kill(record!.externalId, { apiKey })
      await computer.close()
      computer = await e2bProvider.open({ credentials: { apiKey }, workspaceRoot: '', instanceId, instance: record, persist })
      expect(computer.runtimeCapabilities?.volume).toBe(false)
      expect(record?.status).toBe('recreated')
      await expect(computer.readFile('/workspace/keep.txt')).rejects.toThrow()
      await durable.materialize(computer, attachment)
      expect(await computer.readFile('bots/live/MEMORY.md')).toBe('restored by durable storage')
      const status = await computer.status()
      expect(status.detail).toContain('durable files were restored from storage')
      console.log(`E2B fallback recreation verified: ${status.detail}`)
      return
    }
    await computer.writeFile('/workspace/keep.txt', 'kept by volume')
    await Sandbox.kill(record!.externalId, { apiKey })
    await computer.close()
    computer = await e2bProvider.open({ credentials: { apiKey }, workspaceRoot: '', instanceId, instance: record, persist })
    expect(await computer.readFile('/workspace/keep.txt')).toBe('kept by volume')
    expect(await computer.readFile('bots/live/MEMORY.md')).toBe('restored by durable storage')
    expect(record?.status).toBe('recreated')
    expect(computer.notice).toContain('preserved by volume')
    console.log('E2B volume round trip verified: keep.txt survived sandbox recreation')
  }, 120_000)
})
