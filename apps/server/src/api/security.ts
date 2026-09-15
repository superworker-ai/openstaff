import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { JsonValue } from '@openstaff/shared'
import { PLAN_LIMITS } from '@openstaff/shared'
import { requestIp } from '../audit.js'
import { readWorkspaceAuthSettings } from '../auth/workspace-security.js'
import type { AppVariables } from '../auth/session.js'
import { ssoProvider, workspace } from '../db/schema.js'
import type { ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'

const securityInput = z.object({ ssoOnly: z.boolean().optional(), requireTwoFactor: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one setting is required')

export function securityRoutes({ db, config, audit }: Pick<ApiDependencies, 'db' | 'config' | 'audit'>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => ['owner', 'admin'].includes(context.get('user').role) ? next() : context.json({ error: 'Workspace administrator required' }, 403))
  app.get('/', async (context) => context.json({ security: await readWorkspaceAuthSettings(db), sso: { enabled: PLAN_LIMITS[config.plan].sso, domainVerification: config.plan !== 'self-hosted' }, providers: await listProviders() }))
  // The plugin's own /sso/providers only lists providers created by the caller; workspace administrators need all of them, without secrets.
  async function listProviders() {
    const parse = (value: string | null): Record<string, unknown> => { try { return value ? JSON.parse(value) as Record<string, unknown> : {} } catch { return {} } }
    const text = (value: unknown) => typeof value === 'string' ? value : undefined
    const base = config.publicAppUrl ?? ''
    return (await db.select().from(ssoProvider)).map((row) => {
      const saml = row.samlConfig ? parse(row.samlConfig) : undefined, oidc = row.oidcConfig ? parse(row.oidcConfig) : undefined
      const clientId = text(oidc?.clientId)
      return {
        providerId: row.providerId, type: saml ? 'saml' : 'oidc', issuer: row.issuer, domain: row.domain, domainVerified: row.domainVerified,
        spMetadataUrl: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(row.providerId)}`,
        ...(saml ? { samlConfig: { entryPoint: text(saml.entryPoint) ?? '', wantAssertionsSigned: saml.wantAssertionsSigned === true } } : {}),
        ...(oidc ? { oidcConfig: { discoveryEndpoint: text(oidc.discoveryEndpoint) ?? '', clientIdLastFour: clientId ? clientId.slice(-4) : '' } } : {}),
      }
    })
  }
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
