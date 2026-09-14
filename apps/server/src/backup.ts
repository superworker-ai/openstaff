import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { readConfig } from './config.js'
import { resolveDatabasePath } from './db/paths.js'
import { createBackupStore } from './storage/backups.js'

export async function backup(upload = false): Promise<string> {
  const config = readConfig(), backupDir = path.join(config.dataDir, 'backups'), keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 7))
  await fs.mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const destination = path.join(backupDir, `openstaff-${stamp}.db`)
  const client = createClient({ url: `file:${resolveDatabasePath(config.dataDir)}` })
  await client.execute(`VACUUM INTO '${destination.replaceAll("'", "''")}'`)
  await client.close()
  try { await fs.copyFile(path.join(config.dataDir, 'secrets.key'), `${destination}.secrets.key`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const backups = (await fs.readdir(backupDir)).filter((name) => /^(openstaff|superworkers)-.*\.db$/.test(name)).sort().reverse()
  for (const old of backups.slice(keep)) { await fs.rm(path.join(backupDir, old), { force: true }); await fs.rm(path.join(backupDir, `${old}.secrets.key`), { force: true }) }
  if (upload) {
    if (process.env.WORKSPACE_STORE !== 's3') throw new Error('Backup upload requires WORKSPACE_STORE=s3')
    const store = createBackupStore(), name = path.basename(destination)
    try {
      await store.put(name, new Uint8Array(await fs.readFile(destination)), { contentType: 'application/vnd.sqlite3' })
      try { await store.put(`${name}.secrets.key`, new Uint8Array(await fs.readFile(`${destination}.secrets.key`)), { contentType: 'application/octet-stream' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const remote = (await store.list('')).filter((item) => /^(openstaff|superworkers)-.*\.db$/.test(item.key)).sort((left, right) => right.key.localeCompare(left.key))
      for (const old of remote.slice(keep)) { await store.delete(old.key); await store.delete(`${old.key}.secrets.key`) }
    } finally { store.client.destroy() }
  }
  return destination
}
