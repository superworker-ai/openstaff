import { appAliases, appSlug, type MarketplaceApp, type MarketplaceSkill } from '@openstaff/shared'
import { plugins } from '../db/schema.js'
import type { ApiDependencies } from '../api/context.js'

export async function pluginCatalog({ installer, db, registry }: ApiDependencies) {
  const snapshot = installer.marketplace.snapshot()
  const installed = await db.select().from(plugins)
  const visible = snapshot.entries.filter((entry) => !(entry.manifest?.minClientVersions?.grokbot === 'never' && entry.manifest?.minClientVersions?.cursor === 'never'))
  for (const row of installed) if (!visible.some((entry) => entry.name === row.name) && !(row.manifest.minClientVersions?.grokbot === 'never' && row.manifest.minClientVersions?.cursor === 'never')) {
    visible.push({ name: row.name, source: row.source, manifest: row.manifest, hasMcp: Boolean(Object.keys(registry.enabled().find((plugin) => plugin.manifest.name === row.name)?.servers ?? {}).length || row.manifest.mcpServers) })
  }
  return { ...snapshot, entries: visible, installed }
}

export async function mergedApps(deps: ApiDependencies, q = '', limit = 24) {
  const [pluginResult, catalog, servers] = await Promise.all([pluginCatalog(deps), deps.composio.catalogPage(q, limit), deps.registry.oauth.list()])
  const { entries, installed } = pluginResult
  const apps = new Map<string, MarketplaceApp>(catalog.toolkits.map((item) => [appSlug(item.slug), { slug: appSlug(item.slug), name: item.name, description: item.description, logo: item.logo, aliases: [...appAliases(item.slug), ...(item.aliases ?? [])], status: item.connected ? 'Connected' : item.expired ? 'Expired' : 'Available', toolkit: item.slug, plugins: [] }]))
  for (const entry of entries.filter((entry) => entry.hasMcp)) {
    const row = installed.find((item) => item.name === entry.name)
    const slug = appSlug(entry.manifest?.displayName ?? entry.name), name = entry.manifest?.displayName ?? entry.name
    const item = apps.get(slug) ?? { slug, name, description: entry.manifest?.description ?? entry.description ?? '', logo: entry.manifest?.logo, aliases: appAliases(slug), status: 'Available', toolkit: slug, plugins: [] }
    item.aliases.push(entry.name, name)
    item.plugins.push({ name: entry.name, id: row?.id })
    if (row) {
      const auth = servers.filter((server) => server.pluginId === row.id && server.enabled)
      const missingVariables = deps.registry.enabled().find((plugin) => plugin.manifest.name === row.name)?.missingVariables.length
      if (!missingVariables && auth.some((server) => server.connected || server.auth === 'none')) item.status = 'Connected'
      else if (item.status !== 'Connected' && auth.some((server) => server.status === 'Expired' || server.refreshError)) item.status = 'Expired'
      else if (!['Connected', 'Expired'].includes(item.status)) item.status = missingVariables || auth.some((server) => server.needsClientCredentials || server.auth === 'unknown') ? 'Needs setup' : 'Installed, not connected'
    }
    apps.set(slug, item)
  }
  return { apps: [...apps.values()], configured: catalog.configured, warming: catalog.warming || pluginResult.warming, version: catalog.version, total: catalog.total, partial: catalog.warming }
}

export async function skillCatalog(deps: ApiDependencies) {
  const { entries, installed, warming } = await pluginCatalog(deps)
  const skills: MarketplaceSkill[] = entries.filter((entry) => !entry.hasMcp).map((entry) => ({ ...entry, installed: installed.some((row) => row.name === entry.name) }))
  return { skills, warming }
}
