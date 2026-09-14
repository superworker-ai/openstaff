import { appName, createId } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { ConnectionRequiredError } from '../agent/connections.js'
import type { Database } from '../db/index.js'
import { connections } from '../db/schema.js'
import type { AdmissionService } from '../rooms/admission.js'
import type { KeyStore } from '../secrets.js'
import { createComposioClient, type ComposioClient, type ComposioConnection, type ComposioTool } from './client.js'
import { CATALOG_REFRESH_MS, ComposioCatalog } from './catalog.js'

export function isReadOnlyComposioTool(tool: ComposioTool): boolean {
  // SDK tags are not a standardized safety signal, and isNoAuth says nothing about writes.
  return /(?:^|_)(GET|LIST|SEARCH|FETCH|READ|FIND)(?:_|$)/i.test(tool.slug)
}
export class ComposioService {
  private client?: ComposioClient
  private currentKey?: string
  private cache?: { at: number; rows: ComposioConnection[] }
  private catalog?: ComposioCatalog
  private catalogTimer?: ReturnType<typeof setInterval>
  private readonly tools = new Map<string, ComposioTool>()
  private readonly expiredToolkits = new Set<string>()
  constructor(private readonly db: Database, private readonly admission: AdmissionService, private readonly keys: Pick<KeyStore, 'get'>, private readonly dataDir: string, private readonly injected?: ComposioClient) {}
  configured(): boolean { return Boolean(this.injected || this.keys.get('composio')) }
  start() {
    this.refreshCatalog()
    this.catalogTimer = setInterval(() => this.refreshCatalog(), CATALOG_REFRESH_MS)
    this.catalogTimer.unref()
  }
  stop() { clearInterval(this.catalogTimer) }
  refreshCatalog() {
    if (!this.configured()) { this.catalog = undefined; this.client = undefined; this.cache = undefined; return }
    const client = this.getClient()
    this.catalog ??= new ComposioCatalog(client)
    void this.catalog.refresh()
  }
  private getClient(): ComposioClient {
    if (this.injected) return this.injected
    const key = this.keys.get('composio')
    if (!key) throw new Error('Configure a Composio API key in Settings to connect apps')
    if (!this.client || key !== this.currentKey) {
      this.client = createComposioClient(key, this.dataDir); this.currentKey = key
      this.cache = undefined; this.catalog = undefined; this.tools.clear(); this.expiredToolkits.clear()
    }
    return this.client
  }
  async listConnections(fresh = false): Promise<ComposioConnection[]> {
    if (!this.configured()) return []
    const client = this.getClient()
    if (!fresh && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.rows
    const rows = (await client.connections()).map((row) => this.expiredToolkits.has(row.toolkit) ? { ...row, status: 'EXPIRED' } : row)
    const clear = this.db.delete(connections)
    if (rows.length) await this.db.batch([clear, this.db.insert(connections).values(rows.map((row) => ({ id: createId('connection'), provider: 'composio', toolkit: row.toolkit, composioConnectedAccountId: row.id, status: row.status, createdAt: row.createdAt })))])
    else await clear
    this.cache = { at: Date.now(), rows }
    return rows
  }
  async search(query: string, includeUnconnected = false) {
    const client = this.getClient()
    const connected = new Set((await this.listConnections()).filter((item) => item.status === 'ACTIVE').map((item) => item.toolkit))
    if (!includeUnconnected && !connected.size) return []
    const results = await client.search(query, includeUnconnected ? undefined : [...connected])
    return results.filter((item) => includeUnconnected || connected.has(item.toolkit)).slice(0, 10).map((item) => {
      this.tools.set(item.slug, item)
      return { slug: item.slug, toolkit: item.toolkit, description: item.description, connected: connected.has(item.toolkit) }
    })
  }
  async metadata(slug: string): Promise<ComposioTool> {
    const client = this.getClient()
    const value = this.tools.get(slug) ?? await client.metadata(slug)
    this.tools.set(slug, value)
    return value
  }
  async isReadOnly(slug: string): Promise<boolean> { return isReadOnlyComposioTool(await this.metadata(slug)) }
  async execute(slug: string, args: Record<string, unknown>): Promise<unknown> {
    const metadata = await this.metadata(slug)
    if (!await this.connected(metadata.toolkit, true)) throw new ConnectionRequiredError({ source: 'composio', toolkit: metadata.toolkit, appName: appName(metadata.toolkit) })
    const expired = () => new ConnectionRequiredError({ source: 'composio', toolkit: metadata.toolkit, appName: appName(metadata.toolkit) })
    const isExpired = (value: unknown) => /not[ _-]?connected|connection.*expired|account.*expired|connected.account.*(?:invalid|not found)|\b40[13]\b/i.test(value instanceof Error ? value.message : JSON.stringify(value))
    try {
      const result = await this.getClient().execute(slug, args, metadata.version)
      if (result && typeof result === 'object' && ('successful' in result && result.successful === false || 'error' in result && result.error) && isExpired(result)) throw expired()
      return result
    } catch (error) {
      if (error instanceof ConnectionRequiredError || isExpired(error)) {
        this.expiredToolkits.add(metadata.toolkit)
        this.cache = undefined
        await this.db.update(connections).set({ status: 'EXPIRED' }).where(eq(connections.toolkit, metadata.toolkit))
        throw expired()
      }
      throw error
    }
  }
  async verifyConnection(toolkit: string) {
    if (!(await this.getClient().connections()).some((item) => item.toolkit === toolkit && item.status === 'ACTIVE')) throw new Error('Connection is not active yet')
    this.expiredToolkits.delete(toolkit)
    this.cache = undefined
  }
  async connected(toolkit: string, fresh = false) { return (await this.listConnections(fresh)).some((item) => item.toolkit === toolkit && item.status === 'ACTIVE') }
  async disconnect(id: string) {
    const client = this.getClient()
    if (!client.disconnect) throw new Error('Disconnect is unavailable')
    if (!(await this.listConnections(true)).some((item) => item.id === id)) throw new Error('Connection not found')
    await client.disconnect(id)
    this.cache = undefined
  }
  async link(toolkit: string, roomId?: string, callbackUrl?: string) {
    const result = await this.getClient().link(toolkit, callbackUrl)
    if (!['https:', 'http:'].includes(new URL(result.redirectUrl).protocol)) throw new Error('Invalid connection URL')
    this.cache = undefined
    if (roomId) await this.admission.post({ roomId, authorKind: 'system', authorId: null, text: `Connect ${toolkit}: ${result.redirectUrl}`, planReplies: false })
    return result
  }
  async marketplace(query: string) {
    const catalog = await this.catalogPage(query)
    const text = query.toLowerCase()
    return { ...catalog, toolkits: catalog.toolkits.filter((item) => `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(text)) }
  }
  async catalogPage(query = '', limit = 24) {
    if (!this.configured()) return { configured: false, toolkits: [], version: 'unconfigured', total: 0, warming: false }
    const client = this.getClient()
    this.catalog ??= new ComposioCatalog(client)
    const [snapshot, accounts] = await Promise.all([this.catalog.read(query, limit), this.listConnections()])
    const connected = new Set(accounts.filter((item) => item.status === 'ACTIVE').map((item) => item.toolkit))
    const expired = new Set(accounts.filter((item) => ['EXPIRED', 'FAILED'].includes(item.status)).map((item) => item.toolkit))
    return { configured: true, version: snapshot.version, total: snapshot.total, warming: snapshot.warming, toolkits: snapshot.rows.map((item) => ({ ...item, connected: connected.has(item.slug), expired: expired.has(item.slug) })) }
  }
}
