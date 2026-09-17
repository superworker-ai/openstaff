import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { DEFAULT_MODEL } from '@openstaff/shared'
import { adoptLegacyDatabase } from './paths.js'
import * as schema from './schema.js'

export type Database = LibSQLDatabase<typeof schema>

export interface DatabaseHandle {
  db: Database
  client: Client
  close: () => void
}

function migrationsFolder(): string {
  const candidates = [
    path.resolve(process.cwd(), 'apps/server/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(import.meta.dirname, '../../drizzle'),
    path.resolve(import.meta.dirname, '../drizzle'),
  ]
  const found = candidates.find((candidate) => fsSync.existsSync(path.join(candidate, 'meta/_journal.json')))
  if (!found) throw new Error('Could not locate database migrations')
  return found
}

export async function createDatabase(dataDir: string, runMigrations = true, defaultModel = DEFAULT_MODEL): Promise<DatabaseHandle> {
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(path.join(dataDir, 'workspace'), { recursive: true }),
  ])
  const client = createClient({ url: `file:${adoptLegacyDatabase(dataDir)}` })
  const db = drizzle(client, { schema })
  if (runMigrations) {
    await migrate(db, { migrationsFolder: migrationsFolder() })
  }
  await db.insert(schema.workspace).values({
    id: 'workspace',
    name: 'OpenStaff',
    computerDriver: 'local',
    defaultModel,
    replyDecisionModel: process.env.REPLY_DECISION_MODEL || null,
    settings: { auth: { ssoOnly: false, requireTwoFactor: false } },
  }).onConflictDoNothing()
  return { db, client, close: () => client.close() }
}
