import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { describe, expect, it } from 'vitest'
import { createDatabase } from './index.js'
import { users } from './schema.js'

// A copy of drizzle/ with every migration after `lastIdx` removed, so the test can stop at an old schema.
async function migrationsUpTo(directory: string, name: string, lastIdx: number): Promise<string> {
  const folder = path.join(directory, name)
  await fs.cp(path.resolve(import.meta.dirname, '../../drizzle'), folder, { recursive: true })
  const journalPath = path.join(folder, 'meta/_journal.json')
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
  for (const { idx, tag } of journal.entries) if (idx > lastIdx) await fs.rm(path.join(folder, `${tag}.sql`))
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx)
  await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  return folder
}

describe('legacy verification migration', () => {
  it('verifies users carrying a legacy scrypt password and leaves Better Auth users alone', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-legacy-verification-'))
    const url = `file:${path.join(directory, 'openstaff.db')}`
    const now = '2026-09-10T00:00:00.000Z'

    const before = createClient({ url })
    await migrate(drizzle(before), { migrationsFolder: await migrationsUpTo(directory, 'pre-auth', 13) })
    await before.execute({
      sql: 'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['user_legacy', 'legacy@example.test', 'Legacy', 'scrypt:c2FsdA==:aGFzaA==', 'owner', '2026-09-01T00:00:00.000Z'],
    })
    before.close()

    const migrated = createClient({ url })
    await migrate(drizzle(migrated), { migrationsFolder: await migrationsUpTo(directory, 'pre-verify', 16) })
    await migrated.execute({
      sql: 'INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['user_fresh', 'fresh@example.test', 'Fresh', 'member', now, now],
    })
    await migrated.execute({
      sql: 'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: ['acc_fresh', 'user_fresh', 'credential', 'user_fresh', 'better-auth-argon-hash', now, now],
    })
    migrated.close()

    const handle = await createDatabase(directory)
    try {
      const rows = await handle.db.select({ id: users.id, emailVerified: users.emailVerified }).from(users)
      expect(Object.fromEntries(rows.map(({ id, emailVerified }) => [id, emailVerified]))).toEqual({
        user_legacy: true,
        user_fresh: false,
      })
    } finally {
      handle.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
