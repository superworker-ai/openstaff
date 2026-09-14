import { pluginOAuthRoutes } from './plugin-oauth.js'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { validateVariables } from '@openstaff/shared/plugins'
import { plugins } from '../db/schema.js'
import { loadPlugin } from '../plugins/loader.js'
import { pluginFile } from '../plugins/manifest.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ApiDependencies, AppEnv } from './context.js'
import { isResponse, parseBody } from './helpers.js'

export function pluginRoutes(dependencies: ApiDependencies) {
  const { db, secrets, registry, installer } = dependencies
  const app = new Hono<AppEnv>()
  app.route('/', pluginOAuthRoutes(dependencies))
  async function publicPlugin(row: typeof plugins.$inferSelect) {
    const variables = JSON.parse(secrets.decrypt(row.variables)) as Record<string, unknown>
    const parsed = await loadPlugin(row.rootPath, variables)
    const manifest = { ...row.manifest, logo: row.manifest.logo ? `/api/plugins/${row.id}/logo` : undefined }
    return { id: row.id, name: row.name, source: row.source, manifest, enabled: row.enabled, installedAt: row.installedAt,
      variablesConfigured: Object.fromEntries(Object.keys(variables).map((name) => [name, true])),
      skills: parsed.skills.map(({ name, description, frontmatter }) => ({ name, description, frontmatter })),
      rules: parsed.rules.map(({ name, description, frontmatter }) => ({ name, description, frontmatter })),
      agents: parsed.agents.map(({ name, description }) => ({ name, description })),
      hooks: parsed.hooks, missingVariables: parsed.missingVariables,
      // Configuration shape is public; substituted credentials are not.
      mcpServers: Object.fromEntries(Object.entries((await loadPlugin(row.rootPath, {}, false)).servers).map(([name, config]) => [name, config.type === 'stdio'
        ? { type: config.type, command: config.command, args: config.args, envKeys: Object.keys(config.env) }
        : { type: config.type, url: config.url, headerKeys: Object.keys(config.headers) }])),
    }
  }
  app.get('/', async (c) => c.json({ plugins: await Promise.all((await db.select().from(plugins)).map(publicPlugin)) }))
  app.get('/:id/logo', async (c) => {
    const row = (await db.select().from(plugins).where(eq(plugins.id, c.req.param('id'))))[0]
    if (!row?.manifest.logo) return c.notFound()
    if (/^https?:\/\//.test(row.manifest.logo)) return c.redirect(row.manifest.logo)
    const file = await pluginFile(row.rootPath, row.manifest.logo)
    const types: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
    const mime = types[path.extname(file)]
    if (!mime) return c.notFound()
    return new Response(new Uint8Array(await fs.readFile(file)), { headers: { 'content-type': mime, 'content-security-policy': "default-src 'none'; sandbox" } })
  })
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.get('user').role !== 'owner') return c.json({ error: 'Workspace owner required' }, 403)
    await next()
  })
  app.post('/install', async (c) => {
    const input = await parseBody(c, z.object({ source: z.string().min(1) }))
    if (isResponse(input)) return input
    try {
      const id = await installer.install(input.source)
      const row = (await db.select().from(plugins).where(eq(plugins.id, id)))[0]!
      return c.json({ plugin: await publicPlugin(row), servers: await registry.oauth.servers(id) }, 201)
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Installation failed' }, 400) }
  })
  app.patch('/:id', async (c) => {
    const input = await parseBody(c, z.object({ enabled: z.boolean().optional(), variables: z.record(z.string(), z.json()).optional() }))
    if (isResponse(input)) return input
    const row = (await db.select().from(plugins).where(eq(plugins.id, c.req.param('id'))))[0]
    if (!row) return c.json({ error: 'Plugin not found' }, 404)
    try {
      const variables = { ...JSON.parse(secrets.decrypt(row.variables)), ...input.variables }
      if (input.variables) validateVariables(row.manifest.variables, variables)
      await loadPlugin(row.rootPath, variables)
      const updated = (await db.update(plugins).set({ enabled: input.enabled ?? row.enabled, variables: secrets.encrypt(JSON.stringify(variables)) }).where(eq(plugins.id, row.id)).returning())[0]!
      await registry.rebuild()
      return c.json({ plugin: await publicPlugin(updated) })
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid plugin settings' }, 400) }
  })
  app.delete('/:id', async (c) => { await installer.remove(c.req.param('id')); return c.json({ ok: true }) })
  return app
}
