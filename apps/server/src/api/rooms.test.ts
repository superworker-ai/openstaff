import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createApplication, type Application } from '../app.js'
import { rooms as roomsTable } from '../db/schema.js'

type ApiResult = { response: Response; data: Record<string, any> }

async function request(application: Application, cookie: string, url: string, method = 'GET', body?: unknown): Promise<ApiResult> {
  const response = await application.app.request(url, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, data: await response.json() as Record<string, any> }
}

async function signup(application: Application, name: string, email: string): Promise<{ cookie: string; userId: string }> {
  const result = await request(application, '', '/api/auth/signup', 'POST', { name, email, password: 'password123' })
  return { cookie: result.response.headers.get('set-cookie')!.split(';')[0]!, userId: result.data.user.id }
}

async function createBot(application: Application, cookie: string, name: string): Promise<{ botId: string; roomId: string }> {
  const result = await request(application, cookie, '/api/bots', 'POST', { name, job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' } })
  expect(result.response.status).toBe(201)
  return { botId: result.data.bot.id, roomId: result.data.room.id }
}

describe('room sections API', () => {
  it('persists empty sections, canonicalizes assignments, validates names, and protects conditional moves', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-sections-'))
    const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    try {
      const owner = await signup(application, 'Owner', 'owner-sections@example.test')
      const first = await createBot(application, owner.cookie, 'First')

      const created = await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: '  Design  ' })
      expect(created.response.status).toBe(201)
      expect(created.data).toEqual({ section: { name: 'Design' } })
      const duplicate = await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'design' })
      expect(duplicate.response.status).toBe(201)
      expect(duplicate.data).toEqual(created.data)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: '   ' })).response.status).toBe(400)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'x'.repeat(80) })).response.status).toBe(201)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'x'.repeat(81) })).response.status).toBe(400)

      const assigned = await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: ' DESIGN ', expectedSection: null })
      expect(assigned.response.status).toBe(200)
      expect(assigned.data.room.section).toBe('Design')

      const conflicted = await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: 'Operations', expectedSection: null })
      expect(conflicted.response.status).toBe(409)
      expect(conflicted.data).toEqual({ error: 'Room section changed' })
      expect((await request(application, owner.cookie, `/api/rooms/${first.roomId}`)).data.room.section).toBe('Design')

      const renamed = await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { name: 'Renamed' })
      expect(renamed.data.room).toMatchObject({ name: 'Renamed', section: 'Design' })
      const cleared = await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: ' ', expectedSection: 'Design' })
      expect(cleared.response.status).toBe(200)
      expect(cleared.data.room.section).toBeNull()

      const listed = await request(application, owner.cookie, '/api/rooms/sections')
      expect(listed.data.sections.map((section: { name: string }) => section.name)).toEqual(['Design', 'x'.repeat(80)])
    } finally {
      await application.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('unions both room kinds for members without exposing another user private labels', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-section-visibility-'))
    const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    try {
      const owner = await signup(application, 'Owner', 'owner-visibility@example.test')
      const ownerFirst = await createBot(application, owner.cookie, 'Owner First')
      const ownerSecond = await createBot(application, owner.cookie, 'Owner Second')
      await request(application, owner.cookie, `/api/rooms/${ownerFirst.roomId}`, 'PATCH', { section: 'DM Work' })
      const group = await request(application, owner.cookie, '/api/rooms', 'POST', { name: 'Group', botIds: [ownerFirst.botId, ownerSecond.botId], section: 'Group Work' })
      expect(group.response.status).toBe(201)

      const other = await signup(application, 'Other', 'other-visibility@example.test')
      const privateRoom = await createBot(application, other.cookie, 'Private')
      await request(application, other.cookie, '/api/rooms/sections', 'POST', { name: 'Saved Secret' })
      await request(application, other.cookie, `/api/rooms/${privateRoom.roomId}`, 'PATCH', { section: 'Assigned Secret' })

      expect((await request(application, owner.cookie, '/api/rooms/sections')).data.sections).toEqual([
        { name: 'DM Work' },
        { name: 'Group Work' },
      ])
      expect((await request(application, other.cookie, '/api/rooms/sections')).data.sections).toEqual([
        { name: 'Assigned Secret' },
        { name: 'Saved Secret' },
      ])
      expect((await request(application, owner.cookie, `/api/rooms/${privateRoom.roomId}`, 'PATCH', { section: 'Stolen' })).response.status).toBe(404)
    } finally {
      await application.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps saved empty sections after reopening the database', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-section-reopen-'))
    let application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    try {
      const owner = await signup(application, 'Owner', 'owner-reopen@example.test')
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Empty Later' })
      await application.close()
      application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
      expect((await request(application, owner.cookie, '/api/rooms/sections')).data.sections).toEqual([{ name: 'Empty Later' }])
    } finally {
      await application.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('renames populated, empty, legacy, and case-only sections without changing other room fields', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-section-rename-'))
    const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    try {
      const owner = await signup(application, 'Owner', 'owner-rename@example.test')
      const first = await createBot(application, owner.cookie, 'First')
      const second = await createBot(application, owner.cookie, 'Second')
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Planning' })
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Empty' })
      await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: 'Planning' })
      await request(application, owner.cookie, `/api/rooms/${second.roomId}`, 'PATCH', { section: 'Planning' })
      const before = (await application.database.db.select().from(roomsTable).where(eq(roomsTable.id, second.roomId)))[0]!
      const broadcast = vi.spyOn(application.dependencies.hub, 'broadcastRoom')

      const populated = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: ' Planning ', newName: ' Roadmap ' })
      expect(populated.response.status).toBe(200)
      expect(populated.data).toMatchObject({ section: { name: 'Roadmap' }, previousName: 'Planning' })
      expect(populated.data.rooms.map((room: { id: string }) => room.id).sort()).toEqual([first.roomId, second.roomId].sort())
      expect(populated.data.rooms.every((room: Record<string, unknown>) => !Object.hasOwn(room, 'members'))).toBe(true)
      expect(populated.data.rooms.find((room: { id: string }) => room.id === second.roomId)).toEqual({ ...before, section: 'Roadmap' })
      expect(broadcast).toHaveBeenCalledTimes(2)

      const empty = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Empty', newName: 'Archive' })
      expect(empty.data).toEqual({ section: { name: 'Archive' }, previousName: 'Empty', rooms: [] })

      await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: 'Legacy only' })
      const legacy = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'legacy ONLY', newName: 'Long term' })
      expect(legacy.data).toMatchObject({ section: { name: 'Long term' }, previousName: 'Legacy only', rooms: [{ id: first.roomId, section: 'Long term' }] })
      await request(application, owner.cookie, `/api/rooms/${first.roomId}`, 'PATCH', { section: null })
      expect((await request(application, owner.cookie, '/api/rooms/sections')).data.sections).toEqual([
        { name: 'Archive' },
        { name: 'Long term' },
        { name: 'Roadmap' },
      ])

      await application.database.db.update(roomsTable).set({ section: 'ROADMAP' }).where(eq(roomsTable.id, first.roomId))
      const caseOnly = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'roadmap', newName: 'ROADMAP' })
      expect(caseOnly.data).toMatchObject({ section: { name: 'ROADMAP' }, previousName: 'Roadmap', rooms: [{ id: second.roomId, section: 'ROADMAP' }] })
      const callsBeforeNoop = broadcast.mock.calls.length
      const noop = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'ROADMAP', newName: 'ROADMAP' })
      expect(noop.data).toEqual({ section: { name: 'ROADMAP' }, previousName: 'ROADMAP', rooms: [] })
      expect(broadcast).toHaveBeenCalledTimes(callsBeforeNoop)

      const eighty = 'x'.repeat(80)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Archive', newName: eighty })).response.status).toBe(200)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: eighty, newName: 'x'.repeat(81) })).response.status).toBe(400)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'x'.repeat(81), newName: 'Valid' })).response.status).toBe(400)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: ' ', newName: 'Valid' })).response.status).toBe(400)
      expect((await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'ROADMAP', newName: ' ' })).response.status).toBe(400)
    } finally {
      await application.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('renames only caller-visible data and rejects collisions or missing sources', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-room-section-rename-isolation-'))
    const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    try {
      const owner = await signup(application, 'Owner', 'owner-rename-isolation@example.test')
      const shared = await createBot(application, owner.cookie, 'Shared')
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Source' })
      await request(application, owner.cookie, `/api/rooms/${shared.roomId}`, 'PATCH', { section: 'Source' })

      const other = await signup(application, 'Other', 'other-rename-isolation@example.test')
      const privateRoom = await createBot(application, other.cookie, 'Private')
      await request(application, other.cookie, '/api/rooms/sections', 'POST', { name: 'Source' })
      await request(application, other.cookie, '/api/rooms/sections', 'POST', { name: 'Private Target' })
      await request(application, other.cookie, `/api/rooms/${privateRoom.roomId}`, 'PATCH', { section: 'Source' })
      await request(application, owner.cookie, `/api/rooms/${shared.roomId}/members`, 'POST', { kind: 'user', id: other.userId })

      const renamed = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Source', newName: 'Private Target' })
      expect(renamed.response.status).toBe(200)
      expect(renamed.data.rooms).toEqual([expect.objectContaining({ id: shared.roomId, section: 'Private Target' })])
      expect((await request(application, other.cookie, `/api/rooms/${privateRoom.roomId}`)).data.room.section).toBe('Source')
      await request(application, other.cookie, `/api/rooms/${privateRoom.roomId}`, 'PATCH', { section: null })
      expect((await request(application, other.cookie, '/api/rooms/sections')).data.sections).toEqual([
        { name: 'Private Target' },
        { name: 'Source' },
      ])

      const collisionRoom = await createBot(application, owner.cookie, 'Collision')
      await request(application, owner.cookie, `/api/rooms/${collisionRoom.roomId}`, 'PATCH', { section: 'Collision Source' })
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Existing' })
      const collision = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Collision Source', newName: 'eXiStInG' })
      expect(collision.response.status).toBe(409)
      expect(collision.data).toEqual({ error: 'Section already exists' })
      expect((await request(application, owner.cookie, `/api/rooms/${collisionRoom.roomId}`)).data.room.section).toBe('Collision Source')

      const missing = await request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Missing', newName: 'New' })
      expect(missing.response.status).toBe(404)
      expect(missing.data).toEqual({ error: 'Section not found' })

      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Race A' })
      await request(application, owner.cookie, '/api/rooms/sections', 'POST', { name: 'Race B' })
      const raced = await Promise.all([
        request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Race A', newName: 'Race Target' }),
        request(application, owner.cookie, '/api/rooms/sections', 'PATCH', { name: 'Race B', newName: 'Race Target' }),
      ])
      expect(raced.map(({ response }) => response.status).sort()).toEqual([200, 409])
      const racedNames = (await request(application, owner.cookie, '/api/rooms/sections')).data.sections
        .map((section: { name: string }) => section.name)
        .filter((name: string) => name.startsWith('Race'))
      expect(racedNames).toEqual([expect.stringMatching(/^Race [AB]$/), 'Race Target'])
    } finally {
      await application.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
