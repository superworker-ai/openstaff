import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../db/index.js'
import { LocalComputer } from '../computer/local.js'
import type { DurableWriteTarget } from './durable.js'
import { DurableWorkspace } from './durable.js'
import { FsWorkspaceStore } from './fs.js'
import { fakeProvider } from '../computer/fake.js'
import { durableFiles } from '../db/schema.js'

let root: string, storeRoot: string, sandboxRoot: string, handle: DatabaseHandle, durable: DurableWorkspace, sandbox: LocalComputer
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-durable-'))
  storeRoot = path.join(root, 'store'); sandboxRoot = path.join(root, 'sandbox')
  handle = await createDatabase(path.join(root, 'data'))
  durable = new DurableWorkspace(new FsWorkspaceStore(storeRoot), handle.db)
  sandbox = new LocalComputer(sandboxRoot); await sandbox.initialize()
})
afterEach(async () => { vi.useRealTimers(); handle.close(); await fs.rm(root, { recursive: true, force: true }) })

function remoteTarget(): DurableWriteTarget {
  return Object.assign(sandbox, { storageAttachment: async () => ({ hostFiles: false, root: sandboxRoot }) })
}

it('writes to the store before the active Computer', async () => {
  const target = remoteTarget(), original = target.writeFile.bind(target)
  target.writeFile = vi.fn(async (key, data) => {
    expect(Buffer.from(await durable.get(key)).toString()).toBe('remember')
    await original(key, data)
  })
  await durable.writeThrough(target, 'bots/alpha/MEMORY.md', new Uint8Array(Buffer.from('remember')))
  expect(await sandbox.readFile('bots/alpha/MEMORY.md')).toBe('remember')
})

it('materializes durable files and reconciles changed, added, and deleted files after a turn', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
  await durable.put('bots/alpha/MEMORY.md', new Uint8Array(Buffer.from('old')))
  await durable.put('skills/remove/SKILL.md', new Uint8Array(Buffer.from('remove')))
  const attachment = { hostFiles: false, root: sandboxRoot }
  const materialized = await durable.materialize(sandbox, attachment)
  expect(await sandbox.readFile('bots/alpha/MEMORY.md')).toBe('old')
  await sandbox.writeFile('bots/alpha/MEMORY.md', 'new')
  await sandbox.writeFile('uploads/room/new.bin', new Uint8Array([0, 128, 255]))
  await fs.rm(path.join(sandboxRoot, 'skills/remove/SKILL.md'))
  const result = await durable.reconcile(sandbox, attachment, materialized)
  expect(result).toMatchObject({ uploaded: 2, deleted: 1, skipped: 0, finishedAt: '2026-09-14T12:00:00.000Z' })
  expect(Buffer.from(await durable.get('bots/alpha/MEMORY.md')).toString()).toBe('new')
  expect(await durable.get('uploads/room/new.bin')).toEqual(new Uint8Array([0, 128, 255]))
  expect(await durable.store.stat('skills/remove/SKILL.md')).toBeNull()
})

it('uses one filesystem copy when host files are the store root', async () => {
  const direct = new LocalComputer(storeRoot); await direct.initialize()
  const target = Object.assign(direct, { storageAttachment: async () => ({ hostFiles: true, root: storeRoot }) })
  await direct.writeFile('skills/preexisting/SKILL.md', 'description: Already on disk')
  const write = vi.spyOn(target, 'writeFile')
  await durable.writeThrough(target, 'bots/alpha/MEMORY.md', new Uint8Array(Buffer.from('direct')))
  expect(write).not.toHaveBeenCalled()
  expect(await direct.readFile('bots/alpha/MEMORY.md')).toBe('direct')
  expect(await durable.materialize(direct, await target.storageAttachment())).toEqual(new Set())
  expect(await durable.skillsIndex()).toBe('preexisting: Already on disk')
  expect(await durable.status()).toMatchObject({ fileCount: 2 })
  expect(await durable.reconcile(direct, await target.storageAttachment(), new Set())).toMatchObject({ uploaded: 0, deleted: 0 })
})

it('detects same-size edits by mtime and avoids uploads when only mtime changed', async () => {
  const key = 'skills/research/SKILL.md', attachment = { hostFiles: false, root: sandboxRoot }
  await sandbox.writeFile(key, 'description: first')
  await durable.reconcile(sandbox, attachment, new Set())
  await sandbox.writeFile(key, 'description: newer')
  await fs.utimes(path.join(sandboxRoot, key), 1_800_000_000, 1_800_000_000)
  expect(await durable.reconcile(sandbox, attachment, new Set())).toMatchObject({ uploaded: 1 })
  expect(await durable.skillsIndex()).toBe('research: newer')
  await fs.utimes(path.join(sandboxRoot, key), 1_800_000_001, 1_800_000_001)
  const put = vi.spyOn(durable.store, 'put'), read = vi.spyOn(sandbox, 'readFileBytes')
  expect(await durable.reconcile(sandbox, attachment, new Set())).toMatchObject({ uploaded: 0 })
  expect(put).not.toHaveBeenCalled()
  expect(read.mock.calls).toHaveLength(1) // Only the report: unchanged digest needs no content transfer.
})

it('uploads all 400 files through the fake Computer and hashes nothing on the unchanged second pass', async () => {
  const computer = await fakeProvider.open({ workspaceRoot: sandboxRoot, credentials: {}, instanceId: 'scan-test', instance: null, persist: async () => {} })
  const attachment = { hostFiles: false, root: sandboxRoot }
  for (let n = 0; n < 400; n++) await computer.writeFile(`uploads/room/file-${n}.txt`, `payload ${n}`)
  const oversized = path.join(sandboxRoot, 'uploads/room/oversized.bin')
  await fs.writeFile(oversized, ''); await fs.truncate(oversized, 20 * 1024 ** 2 + 1)
  const exec = vi.spyOn(computer, 'exec'), read = vi.spyOn(computer, 'readFileBytes')
  const stat = vi.spyOn(computer, 'stat'), list = vi.spyOn(computer, 'list')
  expect(await durable.reconcile(computer, attachment, new Set())).toMatchObject({ uploaded: 400, skipped: 1 })
  expect(await handle.db.select().from(durableFiles)).toHaveLength(400)
  expect(await durable.store.list('uploads/')).toHaveLength(400)
  expect(exec).toHaveBeenCalledTimes(2) // One inventory exec plus report cleanup.
  expect(exec.mock.calls[0]![0]).toContain("'-printf', r'%s\\t%T@\\t%p\\0'")
  expect((await exec.mock.results[0]!.value).stdout).toContain('hashed=400')
  const reportCall = read.mock.calls.findIndex(([key]) => key.startsWith('.openstaff/reconcile.'))
  expect((await read.mock.results[reportCall]!.value).byteLength).toBeGreaterThan(16 * 1024)
  expect(stat).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled()
  expect(await fs.readdir(path.join(sandboxRoot, '.openstaff'))).toEqual([])
  exec.mockClear(); read.mockClear()
  expect(await durable.reconcile(computer, attachment, new Set())).toMatchObject({ uploaded: 0, skipped: 1 })
  expect(exec).toHaveBeenCalledTimes(2)
  expect(exec.mock.calls[0]![0]).toContain("(r['size'], r['mtime']) !=")
  expect((await exec.mock.results[0]!.value).stdout).toContain('hashed=0')
  expect(read.mock.calls).toHaveLength(1) // The report, no durable content downloads.
  console.log('400-file proof: uploaded=400; unchanged pass uploaded=0, hashed=0; no per-file stat/list calls')
})

it('retains store files when inventory fails and cleans its temporary input', async () => {
  await durable.put('bots/alpha/MEMORY.md', Buffer.from('keep'))
  const attachment = { hostFiles: false, root: sandboxRoot }
  const keys = await durable.materialize(sandbox, attachment)
  vi.spyOn(sandbox, 'exec').mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'vendor-canary' })
  await expect(durable.reconcile(sandbox, attachment, keys)).rejects.toThrow('Workspace inventory failed')
  expect(await durable.readText('bots/alpha/MEMORY.md')).toBe('keep')
  expect(await fs.readdir(path.join(sandboxRoot, '.openstaff'))).toEqual([])
})
