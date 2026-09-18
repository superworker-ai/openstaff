import { appName, appSlug, knownApps, type ConnectedApp } from '@openstaff/shared'
import type { PluginRegistry } from '../plugins/registry.js'
import type { ComposioService } from '../composio/service.js'

const accountStatus = (status: string): ConnectedApp['status'] => status === 'ACTIVE' ? 'connected' : ['EXPIRED', 'FAILED'].includes(status) ? 'expired' : 'not connected'
/** Sorted worst first so the last write into the map is the account the actor would really use. */
const preference = (row: { status: string; scope: 'member' | 'workspace' }) => row.status !== 'ACTIVE' ? 0 : row.scope === 'workspace' ? 1 : 2

export async function availableApps(registry?: PluginRegistry, composio?: ComposioService, actorUserId: string | null = null): Promise<ConnectedApp[]> {
  const apps = new Map<string, ConnectedApp>(knownApps.map((slug) => [slug, { source: 'composio', toolkit: slug, slug, appName: appName(slug), status: 'not connected' }]))
  if (composio?.configured()) {
    try {
      const catalog = await composio.marketplace('', actorUserId)
      const accounts = (await composio.listConnections())
        .filter((row) => row.scope === 'workspace' || Boolean(actorUserId) && row.userId === actorUserId)
        .sort((left, right) => preference(left) - preference(right))
      for (const account of accounts) apps.set(appSlug(account.toolkit), { source: 'composio', toolkit: account.toolkit, slug: appSlug(account.toolkit), appName: appName(account.toolkit), status: accountStatus(account.status), ...(account.status === 'ACTIVE' ? { scope: account.scope } : {}) })
      for (const item of catalog.toolkits) apps.set(appSlug(item.slug), { source: 'composio', toolkit: item.slug, slug: appSlug(item.slug), appName: item.name, logo: item.logo, status: item.connected ? 'connected' : item.expired ? 'expired' : 'not connected', ...(item.scope ? { scope: item.scope } : {}) })
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
