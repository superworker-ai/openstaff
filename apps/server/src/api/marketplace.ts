import { Hono } from 'hono'
import { appSlug } from '@openstaff/shared'
import { plugins } from '../db/schema.js'
import { mergedApps, skillCatalog } from '../marketplace/catalog.js'
import { clampLimit, normalizeQuery, paginate, revision, searchApps, searchSkills } from '../marketplace/pagination.js'
import type { ApiDependencies, AppEnv } from './context.js'
export { connectionRoutes } from './connections.js'

export function marketplaceRoutes(deps: ApiDependencies) {
  const { db, installer, composio } = deps
  const app = new Hono<AppEnv>()
  app.get('/cursor', async (c) => {
    const installed = new Set((await db.select({ name: plugins.name }).from(plugins)).map((row) => row.name))
    const entries = (await installer.marketplace.entries()).filter((entry) => !(entry.manifest?.minClientVersions?.grokbot === 'never' && entry.manifest?.minClientVersions?.cursor === 'never'))
    return c.json({ plugins: entries.map((entry) => ({ ...entry, installed: installed.has(entry.name) })) })
  })
  app.get('/composio', async (c) => c.json(await composio.marketplace(c.req.query('q') ?? '', c.get('user').id)))
  app.get('/apps', async (c) => {
    const q = normalizeQuery(c.req.query('q')), limit = clampLimit(c.req.query('limit'))
    const catalog = await mergedApps(deps, q, limit, c.get('user').id)
    const items = searchApps(catalog.apps, q)
    const version = revision([catalog.version, catalog.warming, catalog.apps])
    const page = paginate(items, q, version, limit, c.req.query('cursor'), catalog.warming)
    // Cold totals are provisional: unseen upstream rows may overlap plugins.
    const total = catalog.partial ? Math.max(page.total, catalog.total) : page.total
    return c.json({ apps: page.items, nextCursor: page.nextCursor, total, configured: catalog.configured, warming: catalog.warming })
  })
  // Refresh one card after an action without rebuilding the client's page sequence.
  app.get('/apps/:slug', async (c) => {
    const catalog = await mergedApps(deps, '', 24, c.get('user').id)
    const item = catalog.apps.find((item) => item.slug === appSlug(c.req.param('slug')))
    return item ? c.json({ app: item, configured: catalog.configured }) : c.json({ error: 'App not found' }, 404)
  })
  app.get('/skills', async (c) => {
    const q = normalizeQuery(c.req.query('q')), limit = clampLimit(c.req.query('limit'))
    const catalog = await skillCatalog(deps), items = searchSkills(catalog.skills, q)
    const page = paginate(items, q, revision([catalog.warming, catalog.skills]), limit, c.req.query('cursor'), catalog.warming)
    return c.json({ skills: page.items, nextCursor: page.nextCursor, total: page.total, configured: true, warming: catalog.warming })
  })
  return app
}
