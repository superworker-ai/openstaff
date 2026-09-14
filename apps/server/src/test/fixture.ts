import fs from 'node:fs/promises'
import path from 'node:path'
import { createId } from '@openstaff/shared'
import { createDatabase } from '../db/index.js'
import { bots, roomMembers, rooms, users } from '../db/schema.js'
import { LocalComputer } from '../computer/local.js'
import { AdmissionService } from '../rooms/admission.js'

export async function fixture() {
  const directory = await fs.mkdtemp(path.resolve('data-test-'))
  const handle = await createDatabase(directory)
  const { db } = handle
  const userId = createId('user'), botId = createId('bot'), roomId = createId('room')
  const now = new Date().toISOString()
  await db.insert(users).values({ id: userId, name: 'Juan', email: `${userId}@example.com`, passwordHash: 'test', role: 'owner', createdAt: now })
  await db.insert(bots).values({ id: botId, slug: 'drake', name: 'drake', job: 'Engineer', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'writes', status: 'idle', createdBy: userId, createdAt: now })
  await db.insert(rooms).values({ id: roomId, kind: 'dm', name: null, createdBy: userId })
  await db.insert(roomMembers).values([{ roomId, memberKind: 'user', memberId: userId, joinedAt: now }, { roomId, memberKind: 'bot', memberId: botId, joinedAt: now }])
  const computer = new LocalComputer(path.join(directory, 'workspace'))
  await computer.initialize()
  return { directory, db, userId, botId, roomId, computer, admission: new AdmissionService(db), close: async () => { handle.close(); await fs.rm(directory, { recursive: true, force: true }) } }
}
