import fs from 'node:fs/promises'
import path from 'node:path'
import { readConfig } from '../apps/server/src/config.js'
import { resolveDatabasePath } from '../apps/server/src/db/paths.js'
import '../apps/server/src/load-env.js'
import { backupRestoreKey, createBackupStore } from '../apps/server/src/storage/backups.js'

const file = process.argv[2]
if (!file) throw new Error('Usage: pnpm db:restore <backup.db | s3://key>')
const config = readConfig(), target = resolveDatabasePath(config.dataDir), lock = path.join(config.dataDir, 'server.lock')
let pid = 0
try { pid = Number((await fs.readFile(lock, 'utf8')).trim()) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (Number.isInteger(pid) && pid > 0) {
  try { process.kill(pid, 0); throw new Error('Refusing restore while the server is running') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
}
await fs.mkdir(config.dataDir, { recursive: true })
let label: string
if (file.startsWith('s3://')) {
  if (process.env.WORKSPACE_STORE !== 's3') throw new Error('S3 restore requires WORKSPACE_STORE=s3')
  const store = createBackupStore(), key = backupRestoreKey(file, store)
  try {
    await fs.writeFile(`${target}.restore-incoming`, await store.get(key))
    try { await fs.writeFile(path.join(config.dataDir, 'secrets.key.restore-incoming'), await store.get(`${key}.secrets.key`), { mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  } finally { store.client.destroy() }
  label = 'configured S3 backup'
} else {
  const source = path.resolve(file)
  await fs.access(source)
  await fs.copyFile(source, `${target}.restore-incoming`)
  const key = `${source}.secrets.key`
  try { await fs.copyFile(key, path.join(config.dataDir, 'secrets.key.restore-incoming')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  label = source
}
await fs.rename(`${target}.restore-incoming`, target)
try { await fs.rename(path.join(config.dataDir, 'secrets.key.restore-incoming'), path.join(config.dataDir, 'secrets.key')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
console.log(`Database restored from: ${label}`)
