import fs from 'node:fs'
import path from 'node:path'

export const DB_FILENAME = 'openstaff.db'
export const LEGACY_DB_FILENAME = 'superworkers.db'
const SIDECARS = ['', '-wal', '-shm', '-journal']

/** Pure lookup: the file the database currently lives in. Never creates, moves or renames anything. */
export function resolveDatabasePath(dataDir: string): string {
  const databasePath = path.join(dataDir, DB_FILENAME)
  const legacyPath = path.join(dataDir, LEGACY_DB_FILENAME)
  return !fs.existsSync(databasePath) && fs.existsSync(legacyPath) ? legacyPath : databasePath
}

/**
 * Called once per process before the database is opened. If only the legacy `superworkers.db`
 * exists it is renamed (with its sidecar files) to `openstaff.db`, so exactly one database file
 * exists afterwards and nothing can bootstrap a second, empty one next to the real data.
 * If both files exist the new one wins, but we warn so the situation is visible in the logs.
 */
export function adoptLegacyDatabase(dataDir: string, log: (message: string) => void = console.warn): string {
  const databasePath = path.join(dataDir, DB_FILENAME)
  const legacyPath = path.join(dataDir, LEGACY_DB_FILENAME)
  const hasNew = fs.existsSync(databasePath), hasLegacy = fs.existsSync(legacyPath)
  if (hasNew && hasLegacy) {
    log(`Both ${DB_FILENAME} and ${LEGACY_DB_FILENAME} exist in ${dataDir}; using ${DB_FILENAME}. Remove or rename the other file to silence this warning.`)
    return databasePath
  }
  if (!hasNew && hasLegacy) {
    for (const suffix of SIDECARS) if (fs.existsSync(legacyPath + suffix)) fs.renameSync(legacyPath + suffix, databasePath + suffix)
    log(`Renamed ${LEGACY_DB_FILENAME} to ${DB_FILENAME} in ${dataDir}`)
  }
  return databasePath
}
