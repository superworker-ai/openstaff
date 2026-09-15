import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@openstaff/shared'
import { createAuditWriter } from '../audit.js'
import { invitationRoutes, memberRoutes, publicInvitationRoutes } from '../api/members.js'
import type { AppEnv } from '../api/context.js'
import { readConfig, type Config } from '../config.js'
import { createDatabase } from '../db/index.js'
import * as schema from '../db/schema.js'
import { account, auditLog, invitations, users } from '../db/schema.js'
import type { EmailMessage } from '../email/index.js'
import { consoleMailer } from '../email/console.js'
import { signedIn, TEST_PASSWORD } from '../test/auth.js'
import { requireAuth } from './session.js'
import { authHandler, createAuth } from './better-auth.js'
import { hashPassword } from './password.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

async function harness(overrides: Partial<Config> = {}, transport?: (message: EmailMessage) => Promise<void>) {
  const directory = await fs.mkdtemp(path.resolve('data-test-auth-'))
  directories.push(directory)
  const database = await createDatabase(directory)
  const config = readConfig({ dataDir: directory, authSecret: 'auth-test-secret-at-least-thirty-two-characters', authSignup: 'open', email: { provider: 'console' }, ...overrides })
  const sent: EmailMessage[] = [], sendEmail = transport ?? (async (message: EmailMessage) => { sent.push(message) })
  const audit = createAuditWriter(database.db), auth = createAuth(config, database.db, { sendEmail, audit })
  const app = new Hono<AppEnv>()
  app.on(['GET', 'POST'], '/api/auth/*', authHandler(auth))
  app.route('/api/invitations', publicInvitationRoutes({ db: database.db }))
  app.use('/api/*', requireAuth(auth))
  app.route('/api/invitations', invitationRoutes({ db: database.db, config, sendEmail, audit }))
  app.route('/api/members', memberRoutes({ db: database.db, audit }))
  return { app, auth, database, config, sent, close: () => database.close() }
}

async function signup(app: Hono<AppEnv>, email: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name: email.split('@')[0], email, password: TEST_PASSWORD, ...extra }) })
}

describe('sign-up policy', () => {
  it('allows open sign-up and assigns exactly one owner', async () => {
    const h = await harness()
    try {
      expect((await signup(h.app, 'owner@example.test')).status).toBe(200)
      expect((await signup(h.app, 'member@example.test')).status).toBe(200)
      const rows = await h.database.db.select({ email: users.email, role: users.role }).from(users).orderBy(users.email)
      expect(rows).toEqual([{ email: 'member@example.test', role: 'member' }, { email: 'owner@example.test', role: 'owner' }])
    } finally { h.close() }
  })

  it('honours a code from the body and closes code mode when no code is configured', async () => {
    const coded = await harness({ authSignup: 'code', signupCode: 'join-us' })
    try {
      const rejected = await signup(coded.app, 'owner@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'invalid_signup_code' })
      expect((await signup(coded.app, 'owner@example.test', { signupCode: 'join-us' })).status).toBe(200)
    } finally { coded.close() }
    const closed = await harness({ authSignup: 'code', signupCode: '' })
    try {
      expect((await signup(closed.app, 'owner@example.test')).status).toBe(200)
      const rejected = await signup(closed.app, 'member@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'signup_closed' })
    } finally { closed.close() }
  })

  it('requires an invitation and applies the hosted member limit', async () => {
    const invited = await harness({ authSignup: 'invite' })
    try {
      expect((await signup(invited.app, 'owner@example.test')).status).toBe(200)
      const rejected = await signup(invited.app, 'member@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'invitation_required' })
    } finally { invited.close() }
    const limited = await harness({ plan: 'starter' })
    try {
      const now = new Date()
      await limited.database.db.insert(users).values([1, 2, 3].map((value) => ({ id: createId('user'), email: `member-${value}@example.test`, name: `Member ${value}`, role: value === 1 ? 'owner' as const : 'member' as const, createdAt: now, updatedAt: now })))
      const rejected = await signup(limited.app, 'four@example.test', {}, { 'x-forwarded-for': '192.0.2.44' })
      expect(rejected.status).toBe(402); expect(await rejected.json()).toMatchObject({ code: 'plan_limit', limit: 'members' })
    } finally { limited.close() }
  })
})

it('runs an invitation round trip with only a SHA-256 token hash stored', async () => {
  const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const created = await h.app.request('http://app.example.test/api/invitations', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invitee@example.test', role: 'admin' }) })
    expect(created.status).toBe(201)
    const token = h.sent[0]!.text.match(/\/invite\/(\S+)/)?.[1]
    expect(token).toBeTruthy()
    const stored = (await h.database.db.select().from(invitations))[0]!
    expect(stored.tokenHash).not.toContain(token!)
    const details = await h.app.request(`http://app.example.test/api/invitations/${token}`)
    expect(await details.json()).toMatchObject({ invitation: { email: 'invitee@example.test', workspaceName: 'OpenStaff' } })
    const invitee = await signedIn(h, { email: 'invitee@example.test' })
    const accepted = await h.app.request(`http://app.example.test/api/invitations/${token}/accept`, { method: 'POST', headers: { cookie: invitee.cookie } })
    expect(accepted.status).toBe(200)
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, invitee.user.id)).limit(1))[0]?.role).toBe('admin')
    expect((await h.database.db.select().from(invitations).where(and(eq(invitations.id, stored.id), isNull(invitations.acceptedAt))))).toHaveLength(0)
  } finally { h.close() }
})

it('lets workspace administrators change roles and remove non-owner members', async () => {
  const h = await harness()
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const member = await signedIn(h, { email: 'member@example.test', role: 'member' })
    const changed = await h.app.request(`/api/members/${member.user.id}`, { method: 'PATCH', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) })
    expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ member: { role: 'admin' } })
    const removed = await h.app.request(`/api/members/${member.user.id}`, { method: 'DELETE', headers: { cookie: owner.cookie } })
    expect(removed.status).toBe(200)
    expect(await h.database.db.select().from(users).where(eq(users.id, member.user.id))).toHaveLength(0)
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toEqual(expect.arrayContaining(['member.role_changed', 'member.removed']))
  } finally { h.close() }
})

it('sends and consumes a magic link and audits successful and failed sign-in', async () => {
  const output: string[] = [], log = vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)) })
  const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] }, consoleMailer)
  try {
    await signedIn(h, { email: 'magic@example.test' })
    const magic = await h.app.request('http://app.example.test/api/auth/sign-in/magic-link', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://app.example.test' }, body: JSON.stringify({ email: 'magic@example.test', callbackURL: '/' }) })
    expect(magic.status).toBe(200); expect(output[0]).toBe('[email] to=magic@example.test subject=Your OpenStaff sign-in link')
    const url = new URL(output.find((line) => line.startsWith('http'))!)
    const verified = await h.app.request(url.toString())
    expect(verified.status).toBe(302); expect(verified.headers.get('set-cookie')).toContain('openstaff.session_token')
    expect((await h.app.request('http://app.example.test/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://app.example.test' }, body: JSON.stringify({ email: 'magic@example.test', password: 'wrong-password' }) })).status).toBe(401)
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toEqual(expect.arrayContaining(['auth.sign_in', 'auth.sign_in_failed']))
  } finally { log.mockRestore(); h.close() }
})

it('signs in a legacy password after the migration copies it to account', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-legacy-auth-'))
  directories.push(directory)
  const client = createClient({ url: `file:${path.join(directory, 'openstaff.db')}` })
  const userId = createId('user'), createdAt = new Date().toISOString(), password = 'legacy-password'
  await client.executeMultiple(`CREATE TABLE users (id text PRIMARY KEY NOT NULL, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, avatar text, role text NOT NULL, created_at text NOT NULL); CREATE TABLE sessions (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, expires_at text NOT NULL); INSERT INTO users (id,email,name,password_hash,avatar,role,created_at) VALUES ('${userId}','legacy@example.test','Legacy','${await hashPassword(password)}',NULL,'owner','${createdAt}');`)
  const migration = (await fs.readFile(path.resolve('apps/server/drizzle/0014_better_auth.sql'), 'utf8')).replaceAll(/\n?\s*\/\*[^]*?\*\/\s*/g, '\n')
  await client.executeMultiple(migration)
  const db = drizzle(client, { schema })
  const config = readConfig({ dataDir: directory, authSecret: 'legacy-test-secret-at-least-thirty-two-characters', authSignup: 'open', email: { provider: 'console' } })
  const auth = createAuth(config, db, { sendEmail: async () => undefined, audit: createAuditWriter(db) })
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', authHandler(auth))
  const response = await app.request('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'legacy@example.test', password }) })
  expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('openstaff.session_token')
  expect((await db.select({ password: account.password }).from(account).where(eq(account.userId, userId)).limit(1))[0]?.password).toMatch(/^scrypt:/)
  client.close()
})

it('reserves Better Auth admin endpoints for the owner and disables the dangerous ones', async () => {
  const h = await harness()
  try {
    const owner = await signedIn(h, { email: 'owner@example.test' })
    const admin = await signedIn(h, { email: 'admin@example.test', role: 'admin' })
    const list = (cookie: string) => h.app.request('/api/auth/admin/list-users', { headers: { cookie } })
    expect((await list(owner.cookie)).status).toBe(200)
    expect((await list(admin.cookie)).status).toBe(403)
    for (const name of ['impersonate-user', 'set-role', 'create-user', 'update-user', 'set-user-password', 'stop-impersonating']) {
      const response = await h.app.request(`/api/auth/admin/${name}`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId: admin.user.id, role: 'owner' }) })
      expect(response.status, name).toBe(404)
    }
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, admin.user.id)))[0]?.role).toBe('admin')
  } finally { h.close() }
})
