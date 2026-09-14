import path from 'node:path'
import { FsWorkspaceStore } from './fs.js'
import { readS3WorkspaceConfig, S3WorkspaceStore } from './s3.js'
import type { WorkspaceStore } from './types.js'

export * from './types.js'
export * from './fs.js'
export * from './s3.js'

export function createWorkspaceStore(dataDir: string, env: NodeJS.ProcessEnv = process.env): WorkspaceStore {
  const kind = env.WORKSPACE_STORE?.trim() || 'fs'
  if (kind === 'fs') return new FsWorkspaceStore(path.join(dataDir, 'workspace'))
  if (kind === 's3') return new S3WorkspaceStore(readS3WorkspaceConfig(env))
  throw new Error('WORKSPACE_STORE must be fs or s3')
}

export function workspaceStoreInfo(store: WorkspaceStore): { kind: 'fs' | 's3'; bucket?: string } {
  if (store.kind === 'fs') return { kind: 'fs' }
  const bucket = 'bucket' in store && typeof store.bucket === 'string' ? store.bucket : undefined
  return { kind: 's3', ...(bucket ? { bucket } : {}) }
}
