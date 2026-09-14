import { count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@openstaff/shared'
import { createSession, destroySession, publicUser, requireAuth, type AppVariables } from '../auth/session.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { users } from '../db/schema.js'
import type { ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

const credentialsSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(200),
})
const signupSchema = credentialsSchema.extend({ name: z.string().trim().min(1).max(80), signupCode: z.string().optional() })

export function authRoutes({ db, config }: ApiDependencies): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()

  app.post('/signup', async (context) => {
    const input = await parseBody(context, signupSchema)
    if (isResponse(input)) return input
    const suppliedCode = context.req.header('x-signup-code') ?? input.signupCode
    if (config.signupCode && suppliedCode !== config.signupCode) return context.json({ error: 'Invalid signup code' }, 403)
    if ((await db.select().from(users).where(eq(users.email, input.email)).limit(1))[0]) return context.json({ error: 'Email already registered' }, 409)
    const total = (await db.select({ value: count() }).from(users))[0]?.value ?? 0
    const row: typeof users.$inferInsert = {
      id: createId('user'), email: input.email, name: input.name, passwordHash: await hashPassword(input.password),
      avatar: null, role: total === 0 ? 'owner' : 'member', createdAt: new Date().toISOString(),
    }
    await db.insert(users).values(row)
    await createSession(context, db, row.id)
    return context.json({ user: publicUser(row as typeof users.$inferSelect) }, 201)
  })

  app.post('/login', async (context) => {
    const input = await parseBody(context, credentialsSchema)
    if (isResponse(input)) return input
    const user = (await db.select().from(users).where(eq(users.email, input.email)).limit(1))[0]
    if (!user || !await verifyPassword(input.password, user.passwordHash)) return context.json({ error: 'Invalid email or password' }, 401)
    await createSession(context, db, user.id)
    return context.json({ user: publicUser(user) })
  })

  app.use('/logout', requireAuth(db))
  app.post('/logout', async (context) => {
    await destroySession(context, db)
    return context.json({ ok: true })
  })

  app.use('/me', requireAuth(db))
  app.get('/me', (context) => context.json({ user: context.get('user') }))
  return app
}
