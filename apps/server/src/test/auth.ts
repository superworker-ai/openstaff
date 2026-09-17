import { eq } from 'drizzle-orm'
import type { User } from '@openstaff/shared'
import { publicUser } from '../auth/session.js'
import type { Database, DatabaseHandle } from '../db/index.js'
import { users } from '../db/schema.js'

interface RequestApplication {
  app: { request: (input: string | Request, init?: RequestInit) => Response | Promise<Response> }
  database: Pick<DatabaseHandle, 'db'> | { db: Database }
}

export const TEST_PASSWORD = 'openstaff-test-password'

export async function signedIn(app: RequestApplication, options: { email?: string; role?: User['role']; name?: string } = {}): Promise<{ user: User; cookie: string }> {
  const email = options.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`
  const response = await app.app.request('/api/auth/sign-up/email', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: options.name ?? 'Test User', password: TEST_PASSWORD }),
  })
  if (!response.ok) throw new Error(`Could not create test user: ${response.status} ${await response.text()}`)
  const payload: unknown = await response.json()
  const rawUser = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>).user : undefined
  const userId = rawUser !== null && typeof rawUser === 'object' && typeof (rawUser as Record<string, unknown>).id === 'string' ? (rawUser as Record<string, unknown>).id as string : undefined
  if (!userId) throw new Error('Better Auth sign-up did not return a user')
  if (options.role) await app.database.db.update(users).set({ role: options.role, updatedAt: new Date() }).where(eq(users.id, userId))
  const row = (await app.database.db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!row || !cookie) throw new Error('Better Auth sign-up did not return a session cookie')
  return { user: publicUser(row), cookie }
}
