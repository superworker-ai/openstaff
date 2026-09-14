import type { PluginOAuthService } from './oauth.js'
import type { RealtimeHub } from '../realtime/hub.js'

export class ConnectionHealth {
  private timer?: ReturnType<typeof setInterval>
  private running?: Promise<void>
  constructor(private readonly oauth: Pick<PluginOAuthService, 'list' | 'server'>, private readonly hub: Pick<RealtimeHub, 'broadcastAll'>, private readonly now = () => Date.now()) {}
  start() { this.timer = setInterval(() => { void this.check().catch(() => console.warn('Connection health check failed')) }, 30 * 60_000); this.timer.unref() }
  check(): Promise<void> {
    return this.running ??= this.scan().finally(() => { this.running = undefined })
  }
  private async scan() {
    for (const item of await this.oauth.list()) {
      if (!item.protected) continue
      try {
        const provider = await this.oauth.server(item.pluginId, item.serverName), result = await provider.checkHealth(this.now())
        if (result) this.hub.broadcastAll({ type: 'connection.updated', app: item.appName, ...result, ts: new Date(this.now()).toISOString() })
      } catch { this.hub.broadcastAll({ type: 'connection.updated', app: item.appName, status: 'expired', error: 'Could not check this connection', ts: new Date(this.now()).toISOString() }) }
    }
  }
  async stop() { if (this.timer) clearInterval(this.timer); await this.running }
}
