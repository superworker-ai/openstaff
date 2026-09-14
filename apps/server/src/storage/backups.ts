import path from 'node:path'
import { readS3WorkspaceConfig, S3WorkspaceStore } from './s3.js'

export function backupPrefix(workspacePrefix: string): string {
  const parent = path.posix.dirname(workspacePrefix.replace(/\/+$/, ''))
  return `${parent === '.' ? '' : `${parent}/`}backups/`
}

export function createBackupStore(env: NodeJS.ProcessEnv = process.env): S3WorkspaceStore {
  const config = readS3WorkspaceConfig(env)
  return new S3WorkspaceStore({ ...config, prefix: backupPrefix(config.prefix) })
}

export function backupRestoreKey(source: string, store: S3WorkspaceStore): string {
  let key = source.slice('s3://'.length).replace(/^\/+/, '')
  if (key.startsWith(`${store.bucket}/`)) key = key.slice(store.bucket.length + 1)
  if (key.startsWith(store.prefix)) key = key.slice(store.prefix.length)
  if (!key || key.includes('/') || !/^(openstaff|superworkers)-.+\.db$/.test(key)) throw new Error('S3 restore key must name a database in the configured backup prefix')
  return key
}
