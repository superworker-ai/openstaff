import { randomUUID } from 'node:crypto'
import type { ComposioClient, ComposioToolkit, ToolkitPage } from './client.js'

export const CATALOG_REFRESH_MS = 15 * 60_000

/** Atomic snapshots: refreshes never replace a usable catalog with an empty one. */
export class ComposioCatalog {
  private rows?: ComposioToolkit[]
  private builtAt = 0
  private attemptedAt = -Infinity
  private building?: Promise<void>
  private version = randomUUID()
  private readonly fallback = new Map<string, Promise<ToolkitPage>>()
  constructor(private readonly client: ComposioClient) {}

  refresh() {
    if (this.building) return this.building
    this.attemptedAt = Date.now()
    this.building = this.client.toolkits().then((rows) => {
      this.rows = rows
      this.builtAt = Date.now()
      this.version = randomUUID()
      this.fallback.clear()
      console.info(`Composio catalog built: ${rows.length} apps in ${this.builtAt - this.attemptedAt}ms`)
    }).catch(() => { console.warn('Composio catalog build failed; retaining the last snapshot') })
      .finally(() => { this.building = undefined })
    return this.building
  }

  async read(q = '', limit = 24) {
    if ((!this.rows || Date.now() - this.builtAt >= CATALOG_REFRESH_MS) && Date.now() - this.attemptedAt >= 3000) void this.refresh()
    if (this.rows) return { rows: this.rows, version: this.version, warming: false, total: this.rows.length }
    // The installed SDK supports toolkits.list({ search }). Only this cold path
    // calls it, with one page, never awaiting the background traversal.
    const key = JSON.stringify([q, limit])
    let first = this.fallback.get(key)
    if (!first) {
      first = this.client.toolkitPage?.({ limit, ...(q ? { search: q } : {}) }) ?? Promise.resolve({ items: [], nextCursor: null, total: 0 })
      if (this.fallback.size >= 100) this.fallback.delete(this.fallback.keys().next().value!)
      this.fallback.set(key, first)
    }
    try {
      const page = await first
      // Capture one consistent revision, even if the full build won the race.
      const rows = this.rows as ComposioToolkit[] | undefined
      if (rows) return { rows, version: this.version, warming: false, total: rows.length }
      return { rows: page.items, version: this.version, warming: true, total: page.total }
    } catch (error) { this.fallback.delete(key); throw error }
  }
}
