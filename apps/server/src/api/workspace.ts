import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { COMPUTER_PROVIDERS, jevBrowserExperimentPatchSchema, jevBrowserExperimentSchema, jevExperimentPatchSchema, jevExperimentSchema, MODEL_PROVIDERS, readExperimentalSettings, type JsonValue, type ModelProvider } from '@openstaff/shared'
import { bots, workspace } from '../db/schema.js'
import { availableApps } from '../agent/app-catalog.js'
import type { AppEnv, ApiDependencies } from './context.js'
import { isResponse, parseBody } from './helpers.js'
import { PlanLimitError } from '../plan.js'
import { MANAGED_PROVIDERS } from '../secrets.js'

/** `typesafe` is deliberately absent: it is not a model provider and is managed in Settings → Experimental. */
const providerKeysBody = z.object(Object.fromEntries(MODEL_PROVIDERS.map((provider) => [provider, z.string().optional()])) as Record<ModelProvider, z.ZodOptional<z.ZodString>>).strict()
const experimentalBody = z.object({
  jev: jevExperimentPatchSchema.extend({ apiKey: z.string().max(400).optional() }).strict().optional(),
  jevBrowser: jevBrowserExperimentPatchSchema.optional(),
}).strict()
/** Only the keys the caller actually sent may overwrite the stored settings. */
const sent = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

/** Counts newline-terminated observation records without loading any room content into a response. */
async function observations(dataDir: string, name: string): Promise<{ count: number; lastAt: string | null }> {
  const file = path.join(dataDir, 'experiments', name)
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
    return { count: content.split('\n').length - 1, lastAt: stat.mtime.toISOString() }
  } catch { return { count: 0, lastAt: null } }
}

export function workspaceRoutes({ db, keys, registry, composio, computer, config, replyDecisionManager, browserActionManager }: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const workspaceRow = async () => (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
  const experimentalState = async () => {
    const { jev, jevBrowser } = readExperimentalSettings((await workspaceRow())?.settings)
    return {
      jev: { ...jev, keyConfigured: Boolean(keys.get('typesafe')), keySource: keys.source('typesafe'), observations: await observations(config.dataDir, 'jev-replies.jsonl') },
      jevBrowser: { ...jevBrowser, observations: await observations(config.dataDir, 'jev-browser-actions.jsonl') },
    }
  }
  app.get('/onboarding', async (c) => {
    const configured = keys.configured()
    const model = ['xai', 'anthropic', 'openai', 'opencode', 'aiGateway'].some((key) => configured[key as keyof typeof configured])
    const hasBots = Boolean((await db.select({ id: bots.id }).from(bots).limit(1))[0])
    const connected = (await availableApps(registry, composio)).some((item) => item.status === 'connected')
    return c.json({ model, connected, hasBots, complete: model && connected && hasBots })
  })
  app.get('/provider-keys', (c) => c.json({ configured: keys.configured() }))
  app.put('/provider-keys', async (c) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(c, providerKeysBody)
    if (isResponse(input)) return input
    if (config.managedKeys && MANAGED_PROVIDERS.some((provider) => input[provider] !== undefined)) return c.json({ error: 'Model and Composio keys are managed by your host', code: 'managed_keys' }, 403)
    await keys.set(input)
    if (input.composio !== undefined) composio.refreshCatalog()
    // A bad Composio key only surfaces later as "Internal server error" inside the connect popup, so reject it here.
    if (input.composio) {
      try { await composio.listConnections(true) }
      catch { await keys.set({ composio: '' }); composio.refreshCatalog(); return c.json({ error: 'Composio rejected that API key.' }, 400) }
    }
    return c.json({ configured: keys.configured() })
  })
  app.get('/experimental', async (c) => c.json(await experimentalState()))
  app.put('/experimental', async (c) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(c, experimentalBody)
    if (isResponse(input)) return input
    const { apiKey, ...fields } = input.jev ?? {}
    const row = await workspaceRow()
    const settings = row?.settings ?? {}
    const stored = readExperimentalSettings(settings)
    const next = jevExperimentSchema.parse({ ...stored.jev, ...sent(fields) })
    const nextBrowser = jevBrowserExperimentSchema.parse({ ...stored.jevBrowser, ...sent(input.jevBrowser ?? {}) })
    // A shadow run without any key would silently do nothing, so refuse it instead of half-saving.
    if ((next.mode === 'shadow' || nextBrowser.mode === 'shadow') && !(apiKey ?? keys.get('typesafe'))) return c.json({ error: 'A TypeSafe API key is required for shadow mode' }, 400)
    if (apiKey !== undefined) await keys.set({ typesafe: apiKey })
    await db.update(workspace).set({ settings: { ...settings, experimental: { jev: next, jevBrowser: nextBrowser } as unknown as JsonValue } }).where(eq(workspace.id, 'workspace'))
    // The shared key may have changed, so both experiments are rebuilt on every save.
    await replyDecisionManager.configure(next, keys.get('typesafe'))
    await browserActionManager.configure(nextBrowser, keys.get('typesafe'))
    return c.json(await experimentalState())
  })
  app.get('/', async (context) => context.json({ workspace: (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0] }))
  app.patch('/', async (context) => {
    if (context.get('user').role !== 'owner') return context.json({ error: 'Workspace owner required' }, 403)
    const input = await parseBody(context, z.object({ name: z.string().trim().min(1).max(100).optional(), defaultModel: z.string().min(3).optional(), replyDecisionModel: z.string().min(3).nullable().optional(), computerDriver: z.enum(COMPUTER_PROVIDERS).optional() }))
    if (isResponse(input)) return input
    if (input.computerDriver) {
      try { await computer.setProvider(input.computerDriver) } catch (error) { if (error instanceof PlanLimitError) return context.json(error.body(), 402); const message = error instanceof Error ? error.message : 'Computer provider change failed'; return context.json({ error: message }, /running|waiting/.test(message) ? 409 : 400) }
    }
    const patch = { ...input }; delete patch.computerDriver
    const value = Object.keys(patch).length
      ? (await db.update(workspace).set(patch).where(eq(workspace.id, 'workspace')).returning())[0]
      : (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
    return context.json({ workspace: value })
  })
  return app
}
