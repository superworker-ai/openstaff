import { appName, appSlug, knownApps, type ConnectedApp } from '@openstaff/shared'
import type { PluginRegistry } from '../plugins/registry.js'
import type { ComposioService } from '../composio/service.js'

export async function availableApps(registry?: PluginRegistry, composio?: ComposioService): Promise<ConnectedApp[]> {
  const apps = new Map<string, ConnectedApp>(knownApps.map((slug) => [slug, { source: 'composio', toolkit: slug, slug, appName: appName(slug), status: 'not connected' }]))
  if (composio?.configured()) {
    try {
      const catalog = await composio.marketplace(''), accounts = await composio.listConnections()
      for (const account of accounts) apps.set(appSlug(account.toolkit), { source: 'composio', toolkit: account.toolkit, slug: appSlug(account.toolkit), appName: appName(account.toolkit), status: account.status === 'ACTIVE' ? 'connected' : ['EXPIRED', 'FAILED'].includes(account.status) ? 'expired' : 'not connected' })
      for (const item of catalog.toolkits) apps.set(appSlug(item.slug), { source: 'composio', toolkit: item.slug, slug: appSlug(item.slug), appName: item.name, logo: item.logo, status: item.connected ? 'connected' : accounts.some((account) => account.toolkit === item.slug && ['EXPIRED', 'FAILED'].includes(account.status)) ? 'expired' : 'not connected' })
    } catch { /* Installed plugins and suggested apps remain available during a catalog outage. */ }
  }
  for (const item of await registry?.oauth.list() ?? []) {
    if (!item.enabled) continue
    const slug = appSlug(item.appName)
    if (apps.get(slug)?.status === 'connected') continue
    apps.set(slug, { source: 'mcp', pluginId: item.pluginId, serverName: item.serverName, slug, appName: item.appName, status: item.refreshError || item.status === 'Expired' ? 'expired' : item.connected || item.auth === 'none' ? 'connected' : 'not connected', lastCheckedAt: item.lastCheckedAt, error: item.refreshError ?? item.error })
  }
  return [...apps.values()]
}
