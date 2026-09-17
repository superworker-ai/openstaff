import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { createApplication, type Application } from '../app.js'
import { users } from '../db/schema.js'

const applications: Application[] = [], directories: string[] = []
const clock = { now: () => new Date('2026-09-17T12:00:00.000Z'), schedule: () => ({ stop() {} }) }

afterEach(async () => {
  for (const application of applications.splice(0).reverse()) await application.close()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function application() {
  const directory = await fs.mkdtemp(path.resolve('data-test-bootstrap-'))
  directories.push(directory)
  const value = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0, authSignup: 'invite', signupCode: '' }, automationClock: clock })
  applications.push(value)
  return value
}

const signup = (value: Application, email: string) => value.app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Owner', email, password: 'password123' }) })

it('reports bootstrap until the first owner exists, then enforces the invite-only policy', async () => {
  const value = await application()
  expect(await (await value.app.request('/api/auth-config')).json()).toMatchObject({ signup: 'invite', bootstrap: true })
  expect((await signup(value, 'owner@example.test')).status).toBe(200)
  expect((await value.database.db.select({ role: users.role }).from(users).where(eq(users.email, 'owner@example.test')).limit(1))[0]?.role).toBe('owner')
  expect(await (await value.app.request('/api/auth-config')).json()).toMatchObject({ signup: 'invite', bootstrap: false })
  const rejected = await signup(value, 'member@example.test')
  expect(rejected.status).toBe(403)
  expect(await rejected.json()).toMatchObject({ code: 'invitation_required' })
})
