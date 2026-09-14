import { validateManifest, validateMarketplace } from '@openstaff/shared/plugins'
import { describeServerAuth } from './oauth.js'
import type { MarketplaceEntry, PluginManifest } from '@openstaff/shared'

export const DEFAULT_MARKETPLACE = 'https://raw.githubusercontent.com/cursor/plugins/main/.cursor-plugin/marketplace.json'
export function marketplaceLocation(url: string) {
  const parsed = new URL(url)
  if (parsed.hostname === 'raw.githubusercontent.com') {
    const [owner, repository, branch, ...parts] = parsed.pathname.slice(1).split('/')
    const base = parts.slice(0, -2).join('/')
    return { repository: `https://github.com/${owner}/${repository}.git`, branch, rawRoot: `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${base ? `${base}/` : ''}` }
  }
  return { repository: process.env.PLUGIN_MARKETPLACE_REPO, branch: undefined, rawRoot: new URL('../', url).href }
}
export class CursorMarketplace {
  private cache?: { at: number; entries: Array<MarketplaceEntry & { manifest?: PluginManifest; oauth?: boolean; hasMcp?: boolean }> }
  private building?: ReturnType<CursorMarketplace['build']>
  private attemptedAt = -Infinity
  constructor(readonly url = process.env.PLUGIN_MARKETPLACE_URL || DEFAULT_MARKETPLACE) {}
  snapshot() {
    if ((!this.cache || Date.now() - this.cache.at >= 300_000) && Date.now() - this.attemptedAt >= 3000) {
      this.attemptedAt = Date.now()
      void this.entries().catch(() => { console.warn('Plugin catalog build failed; retaining the last snapshot') })
    }
    return { entries: this.cache?.entries ?? [], warming: !this.cache }
  }
  async entries() {
    if (this.cache && Date.now() - this.cache.at < 300_000) return this.cache.entries
    this.building ??= this.build().finally(() => { this.building = undefined })
    return this.building
  }
  private async build() {
    const started = Date.now()
    const response = await fetch(this.url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Marketplace request failed (${response.status})`)
    const marketplace = validateMarketplace(await response.json())
    const entries = marketplace.plugins.filter((entry) => !(entry.minClientVersions?.grokbot === 'never' && entry.minClientVersions?.cursor === 'never'))
    const root = marketplaceLocation(this.url).rawRoot
    const hydrated: Array<MarketplaceEntry & { manifest?: PluginManifest; oauth?: boolean; hasMcp?: boolean }> = []
    for (let offset = 0; offset < entries.length; offset += 8) {
      hydrated.push(...await Promise.all(entries.slice(offset, offset + 8).map(async (entry) => {
        try {
          if (/^https?:/.test(entry.source)) return entry
          const manifestResponse = await fetch(new URL(`${entry.source.replace(/^\.\//, '')}/.cursor-plugin/plugin.json`, root), { signal: AbortSignal.timeout(6_000) })
          if (!manifestResponse.ok) return entry
          const manifest = validateManifest(await manifestResponse.json())
          if (manifest.logo && !/^https?:/.test(manifest.logo)) manifest.logo = new URL(`${entry.source.replace(/^\.\//, '')}/${manifest.logo}`, root).href
          const pluginRoot = new URL(`${entry.source.replace(/^\.\//, '')}/`, root)
          const configs = manifest.mcpServers ?? 'mcp.json'
          const urls: string[] = []
          let hasMcp = false
          for (const source of Array.isArray(configs) ? configs : [configs]) {
            try {
              const response = typeof source === 'string' ? await fetch(new URL(source, pluginRoot), { signal: AbortSignal.timeout(6000) }) : undefined
              const raw = response ? (response.ok ? await response.json() : {}) : source
              for (const config of Object.values(raw.mcpServers ?? raw)) {
                if (config && typeof config === 'object' && ('command' in config || 'url' in config) && !('disabled' in config && config.disabled)) hasMcp = true
                if (config && typeof config === 'object' && 'url' in config && typeof config.url === 'string' && !('command' in config) && !('disabled' in config && config.disabled)) urls.push(config.url)
              }
            } catch { /* Missing optional MCP config does not hide marketplace entries. */ }
          }
          const descriptions = await Promise.all(urls.map((url) => describeServerAuth(url).catch(() => undefined)))
          return { ...entry, manifest, hasMcp, oauth: descriptions.some((description) => description?.protected) }
        } catch { return entry }
      })))
    }
    this.cache = { at: Date.now(), entries: hydrated }
    console.info(`Plugin catalog built: ${hydrated.length} entries in ${Date.now() - started}ms`)
    return hydrated
  }
}
