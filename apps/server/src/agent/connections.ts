import { appName, appSlug, knownApps, type AppConnection } from '@openstaff/shared'
import { tool } from 'ai'
import { z } from 'zod'
import type { PluginRegistry } from '../plugins/registry.js'
import type { ComposioService } from '../composio/service.js'
import { availableApps } from './app-catalog.js'

export class ConnectionRequiredError extends Error {
  constructor(readonly connection: AppConnection) { super(`connect:${connection.appName}`); this.name = 'ConnectionRequiredError' }
}
export class AgentConnections {
  constructor(private readonly registry?: PluginRegistry, private readonly composio?: ComposioService) {}
  async find(app: string): Promise<AppConnection | undefined> {
    return (await availableApps(this.registry, this.composio)).find((item) => item.slug === appSlug(app) || appSlug(item.appName) === appSlug(app))
  }
  async missing(toolName: string, input: unknown): Promise<AppConnection | undefined> {
    if (toolName === 'composio_execute' && this.composio) {
      const slug = (input as { slug: string }).slug
      const metadata = await this.composio.metadata(slug)
      if (!await this.composio.connected(metadata.toolkit, true)) return { source: 'composio', toolkit: metadata.toolkit, appName: appName(metadata.toolkit) }
    }
    if (toolName === 'request_connection') {
      const connection = await this.find((input as { app: string }).app)
      if (connection && !await this.connected(connection)) return connection
    }
    return undefined
  }
  async connected(connection: AppConnection): Promise<boolean> {
    if (connection.source === 'composio') return await this.composio?.connected(connection.toolkit!, true) ?? false
    const provider = await this.registry?.oauth.server(connection.pluginId!, connection.serverName!)
    if ((await provider?.row())?.refreshError) return false
    return provider ? !provider.description.protected || await provider.ensureConnected() : false
  }
  async prompt(): Promise<string> {
    const lines: string[] = []
    for (const plugin of this.registry?.enabled() ?? []) {
      if (plugin.missingVariables.length) lines.push(`${plugin.manifest.displayName ?? plugin.manifest.name} — needs variables`)
      else for (const [name, config] of Object.entries(plugin.servers)) {
        if (config.type === 'stdio') { lines.push(`${plugin.manifest.displayName ?? name} — configured (plugin)`); continue }
        try {
          const provider = await this.registry?.oauth.forRuntime(plugin.manifest.name, name, config.url)
          const expired = (await provider?.row())?.refreshError
          lines.push(`${plugin.manifest.displayName ?? name} — ${expired ? 'expired, not connected' : !provider || !provider.description.protected || await provider.connected() ? 'connected (plugin)' : 'installed, not connected'}`)
        } catch { lines.push(`${plugin.manifest.displayName ?? name} — connection error`) }
      }
    }
    if (this.composio?.configured()) {
      try {
        const catalog = await this.composio.marketplace('')
        lines.push(...catalog.toolkits.map((item) => `${item.name} — ${item.connected ? 'connected (Composio)' : 'available, not connected (Composio)'}`))
      } catch { lines.push('Composio — connection status unavailable; do not claim app access') }
    }
    for (const name of knownApps.map(appName)) if (!lines.some((line) => line.startsWith(`${name} —`))) lines.push(`${name} — available, not connected`)
    return `Apps\n${lines.join('\n') || '(No apps connected.)'}\nNever claim access to an app that is not connected. If the human asks for it, call request_connection with the app name. A connection request pauses this turn until the human connects or declines. If they decline, explain that you cannot access the app yet.`
  }
  tools() {
    return { request_connection: tool({ description: 'Ask the human to connect an app and wait for their response before continuing. Does not call the app.', inputSchema: z.object({ app: z.string() }), execute: async ({ app }) => {
      const connection = await this.find(app)
      return connection && await this.connected(connection) ? { connected: true, app: connection.appName } : { connected: false, message: `Install or configure ${app} in Apps first.` }
    } }) }
  }
}
