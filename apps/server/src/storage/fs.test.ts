import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe } from 'vitest'
import { workspaceStoreContract } from './contract.js'
import { FsWorkspaceStore } from './fs.js'

describe('filesystem workspace store', () => {
  let root: string, store: FsWorkspaceStore
  beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-storage-fs-')); store = new FsWorkspaceStore(root); await store.healthy() })
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })
  workspaceStoreContract(() => store)
})
