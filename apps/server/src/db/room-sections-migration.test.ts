import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { describe, expect, it } from 'vitest'
import { createDatabase } from './index.js'
import { roomSections, rooms } from './schema.js'

describe('room sections migration', () => {
  it('adds the registry without changing existing room section metadata', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-section-migration-'))
    const oldMigrations = path.join(directory, 'old-migrations')
    const sourceMigrations = path.resolve(import.meta.dirname, '../../drizzle')
    await fs.cp(sourceMigrations, oldMigrations, { recursive: true })
    await fs.rm(path.join(oldMigrations, '0013_room_sections.sql'))
    const journalPath = path.join(oldMigrations, 'meta/_journal.json')
    const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
    journal.entries = journal.entries.filter(({ idx }) => idx <= 12)
    await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`)

    const client = createClient({ url: `file:${path.join(directory, 'openstaff.db')}` })
    await migrate(drizzle(client), { migrationsFolder: oldMigrations })
    await client.execute({ sql: 'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)', args: ['user_existing', 'existing@example.test', 'Existing', 'hash', 'owner', '2026-09-01T00:00:00.000Z'] })
    await client.execute({ sql: 'INSERT INTO rooms (id, kind, name, section, created_by, last_message_at, last_message_preview) VALUES (?, ?, ?, ?, ?, ?, ?)', args: ['room_existing', 'group', 'Existing room', 'Keep Me', 'user_existing', '2026-09-02T00:00:00.000Z', 'Existing preview'] })
    client.close()

    const handle = await createDatabase(directory)
    try {
      expect((await handle.db.select().from(rooms))[0]).toMatchObject({
        id: 'room_existing',
        section: 'Keep Me',
        lastMessageAt: '2026-09-02T00:00:00.000Z',
        lastMessagePreview: 'Existing preview',
      })
      expect(await handle.db.select().from(roomSections)).toEqual([])
    } finally {
      handle.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
