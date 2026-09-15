import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { JsonValue } from '@openstaff/shared'
import { PLAN_LIMITS } from '@openstaff/shared'
import { requestIp } from '../audit.js'
import { readWorkspaceAuthSettings } from '../auth/workspace-security.js'
import type { AppVariables } from '../auth/session.js'
import { workspace } from '../db/schema.js'
import type { ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

const securityInput = z.object({ ssoOnly: z.boolean().optional(), requireTwoFactor: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one setting is required')

export function securityRoutes({ db, config, audit }: Pick<ApiDependencies, 'db' | 'config' | 'audit'>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => ['owner', 'admin'].includes(context.get('user').role) ? next() : context.json({ error: 'Workspace administrator required' }, 403))
  app.get('/', async (context) => context.json({ security: await readWorkspaceAuthSettings(db), sso: { enabled: PLAN_LIMITS[config.plan].sso, domainVerification: config.plan !== 'self-hosted' } }))
  app.patch('/', async (context) => {
    const actor = context.get('user')
    if (actor.role !== 'owner') return context.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(context, securityInput)
    if (isResponse(input)) return input
    const row = (await db.select({ settings: workspace.settings }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
    if (!row) return context.json({ error: 'Workspace not found' }, 404)
    const before = await readWorkspaceAuthSettings(db), after = { ...before, ...input }
    const settings: Record<string, JsonValue> = { ...row.settings, auth: after }
    await db.update(workspace).set({ settings }).where(eq(workspace.id, 'workspace'))
    const diff = Object.fromEntries((Object.keys(after) as Array<keyof typeof after>).filter((key) => before[key] !== after[key]).map((key) => [key, { from: before[key], to: after[key] }])) as Record<string, JsonValue>
    if (Object.keys(diff).length) await audit({ actorUserId: actor.id, actorIp: requestIp(context.req.raw.headers), event: 'security.setting_changed', targetType: 'workspace', targetId: 'workspace', metadata: { diff } })
    return context.json({ security: after })
  })
  return app
}
