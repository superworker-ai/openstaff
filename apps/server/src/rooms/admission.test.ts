import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId } from '@openstaff/shared'
import { createDatabase, type DatabaseHandle } from '../db/index.js'
import { bots, roomMembers, rooms, users } from '../db/schema.js'
import { AdmissionService } from './admission.js'

describe('message admission', () => {
  let directory = ''
  let handle: DatabaseHandle
  let service: AdmissionService
  const userId = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV'
  const roomId = 'room_01ARZ3NDEKTSV4RRFFQ69G5FAV'

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.resolve('data-test-db-'))
    handle = await createDatabase(directory)
    service = new AdmissionService(handle.db)
    const now = new Date().toISOString()
    await handle.db.insert(users).values({ id: userId, email: 'a@example.com', name: 'A', avatar: null, role: 'owner', createdAt: new Date(now), updatedAt: new Date(now) })
    await handle.db.insert(rooms).values({ id: roomId, kind: 'dm', name: null, section: null, createdBy: userId, lastMessageAt: null, lastMessagePreview: null })
    const botId = createId('bot')
    await handle.db.insert(bots).values({ id: botId, slug: 'helper', name: 'Helper', avatar: { shape: 'circle', color: '#2E90FA' }, job: 'Help', instructions: '', model: null, reasoningEffort: null, approvalPolicy: 'auto', status: 'idle', createdBy: userId, createdAt: now })
    await handle.db.insert(roomMembers).values([
      { roomId, memberKind: 'user', memberId: userId, joinedAt: now },
      { roomId, memberKind: 'bot', memberId: botId, joinedAt: now },
    ])
  })

  afterEach(async () => {
    handle.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('allocates monotonic sequences under concurrent posting', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => service.post({
      roomId, authorKind: 'user', authorId: userId, text: `message ${index}`, clientRequestId: `request-${index}`,
    })))
    expect(results.map((result) => result.message.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('deduplicates a client request without creating a second turn', async () => {
    const first = await service.post({ roomId, authorKind: 'user', authorId: userId, text: 'hello', clientRequestId: 'same' })
    const second = await service.post({ roomId, authorKind: 'user', authorId: userId, text: 'hello again', clientRequestId: 'same' })
    expect(second.message.id).toBe(first.message.id)
    expect(second.deduplicated).toBe(true)
    expect(second.turns).toEqual([])
  })
})
