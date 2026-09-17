import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { createId } from '@openstaff/shared'
import { createDatabase } from '../db/index.js'
import { bots, roomMembers, rooms } from '../db/schema.js'
import { LocalComputer } from '../computer/local.js'
import { AdmissionService } from '../rooms/admission.js'
import { readConfig } from '../config.js'
import { createAuditWriter } from '../audit.js'
import { createAuth } from '../auth/better-auth.js'
import { signedIn } from './auth.js'

export async function fixture() {
  const directory = await fs.mkdtemp(path.resolve('data-test-'))
  const handle = await createDatabase(directory)
  const { db } = handle
  const config = readConfig({ dataDir: directory, authSecret: 'test-secret-at-least-thirty-two-characters', authSignup: 'open', email: { provider: 'console' } })
  const auth = createAuth(config, db, { sendEmail: async () => undefined, audit: createAuditWriter(db) })
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw))
  const signed = await signedIn({ app, database: handle }, { email: `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, name: 'Juan', role: 'owner' })
  const userId = signed.user.id, botId = createId('bot'), roomId = createId('room')
  const now = new Date().toISOString()
  await db.insert(bots).values({ id: botId, slug: 'drake', name: 'drake', job: 'Engineer', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'writes', status: 'idle', createdBy: userId, createdAt: now })
  await db.insert(rooms).values({ id: roomId, kind: 'dm', name: null, createdBy: userId })
  await db.insert(roomMembers).values([{ roomId, memberKind: 'user', memberId: userId, joinedAt: now }, { roomId, memberKind: 'bot', memberId: botId, joinedAt: now }])
  const computer = new LocalComputer(path.join(directory, 'workspace'))
  await computer.initialize()
  return { app, auth, database: handle, cookie: signed.cookie, directory, db, userId, botId, roomId, computer, admission: new AdmissionService(db), close: async () => { handle.close(); await fs.rm(directory, { recursive: true, force: true }) } }
}
