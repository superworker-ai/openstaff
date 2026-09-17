import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { describe, expect, it } from 'vitest'
import { createDatabase } from './index.js'
import { users } from './schema.js'

describe('better auth migration', () => {
  it('keeps the earliest owner and demotes any other legacy owners to admin', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-auth-owner-migration-'))
    const oldMigrations = path.join(directory, 'old-migrations')
    const sourceMigrations = path.resolve(import.meta.dirname, '../../drizzle')
    await fs.cp(sourceMigrations, oldMigrations, { recursive: true })
    for (const file of ['0014_computer_sessions.sql', '0015_better_auth.sql', '0016_auth_phase_b.sql']) {
      await fs.rm(path.join(oldMigrations, file))
    }
    const journalPath = path.join(oldMigrations, 'meta/_journal.json')
    const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
    journal.entries = journal.entries.filter(({ idx }) => idx <= 13)
    await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`)

    const client = createClient({ url: `file:${path.join(directory, 'openstaff.db')}` })
    await migrate(drizzle(client), { migrationsFolder: oldMigrations })
    const insert = 'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    await client.execute({ sql: insert, args: ['user_second', 'second@example.test', 'Second', 'hash', 'owner', '2026-09-02T00:00:00.000Z'] })
    await client.execute({ sql: insert, args: ['user_first', 'first@example.test', 'First', 'hash', 'owner', '2026-09-01T00:00:00.000Z'] })
    await client.execute({ sql: insert, args: ['user_member', 'member@example.test', 'Member', 'hash', 'member', '2026-09-03T00:00:00.000Z'] })
    client.close()

    const handle = await createDatabase(directory)
    try {
      const rows = await handle.db.select({ id: users.id, role: users.role }).from(users)
      expect(Object.fromEntries(rows.map(({ id, role }) => [id, role]))).toEqual({
        user_first: 'owner',
        user_second: 'admin',
        user_member: 'member',
      })
    } finally {
      handle.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
