import { eq } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { plugins } from '../db/schema.js'
import type { Secrets } from '../secrets.js'
import { loadPlugin, type LoadedPlugin } from './loader.js'
import { readPluginFile } from './manifest.js'
import { PluginOAuthService } from './oauth.js'
import { MCPClientPool } from './mcp-pool.js'

export class PluginRegistry {
  readonly mcpPool = new MCPClientPool()
  private cache: LoadedPlugin[] = []
  private revision = 0
  readonly oauth: PluginOAuthService
  constructor(private readonly db: Database, private readonly secrets: Secrets, publicAppUrl?: string) { this.oauth = new PluginOAuthService(db, secrets, publicAppUrl) }
  enabled(): LoadedPlugin[] { return this.cache }
  async rebuild(): Promise<void> {
    const revision = ++this.revision
    await this.mcpPool.close()
    const next: LoadedPlugin[] = []
    for (const row of await this.db.select().from(plugins).where(eq(plugins.enabled, true))) {
      try { next.push(await loadPlugin(row.rootPath, JSON.parse(this.secrets.decrypt(row.variables)))) }
      catch (error) { console.warn(`Plugin ${row.name} skipped: ${error instanceof Error ? error.message : 'load failed'}`) }
    }
    if (revision === this.revision) this.cache = next
  }
  async readSkill(name: string): Promise<string | undefined> {
    for (const plugin of this.cache) {
      const skill = plugin.skills.find((item) => `${plugin.manifest.name}/${item.name}` === name)
      if (skill) return readPluginFile(plugin.root, skill.path)
    }
    return undefined
  }
  async readFile(name: string, relativePath: string): Promise<string> {
    const plugin = this.cache.find((item) => item.manifest.name === name)
    if (!plugin) throw new Error('Plugin is not enabled')
    return readPluginFile(plugin.root, relativePath)
  }
}
