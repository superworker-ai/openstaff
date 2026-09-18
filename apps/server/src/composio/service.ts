import { appName, createId } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { ConnectionRequiredError } from '../agent/connections.js'
import type { Database } from '../db/index.js'
import { connections, users } from '../db/schema.js'
import type { AdmissionService } from '../rooms/admission.js'
import type { KeyStore } from '../secrets.js'
import { createComposioClient, type ComposioClient, type ComposioConnection, type ComposioTool } from './client.js'
import { CATALOG_REFRESH_MS, ComposioCatalog } from './catalog.js'

export type ConnectionScope = 'workspace' | 'member'
export type ScopedConnection = Omit<ComposioConnection, 'userId'> & { scope: ConnectionScope; userId: string | null }
export type ConnectionTarget = { scope: 'workspace' } | { scope: 'member'; userId: string }

export function isReadOnlyComposioTool(tool: ComposioTool): boolean {
  // SDK tags are not a standardized safety signal, and isNoAuth says nothing about writes.
  return /(?:^|_)(GET|LIST|SEARCH|FETCH|READ|FIND)(?:_|$)/i.test(tool.slug)
}

export class ComposioService {
  private client?: ComposioClient
  private currentKey?: string
  private cache?: { at: number; rows: ScopedConnection[] }
  private catalog?: ComposioCatalog
  private catalogTimer?: ReturnType<typeof setInterval>
  private readonly tools = new Map<string, ComposioTool>()
  private readonly expiredAccounts = new Set<string>()

  constructor(
    private readonly db: Database,
    private readonly admission: AdmissionService,
    private readonly keys: Pick<KeyStore, 'get'>,
    private readonly dataDir: string,
    private readonly injected?: ComposioClient,
    private readonly workspaceUserId = 'workspace',
  ) {}

  configured(): boolean { return Boolean(this.injected || this.keys.get('composio')) }
  memberUserId(userId: string): string { return `${this.workspaceUserId}:${userId}` }
  scopeOf(composioUserId: string): { scope: 'workspace' } | { scope: 'member'; userId: string } {
    if (composioUserId === this.workspaceUserId) return { scope: 'workspace' }
    const prefix = `${this.workspaceUserId}:`
    if (composioUserId.startsWith(prefix) && composioUserId.length > prefix.length) return { scope: 'member', userId: composioUserId.slice(prefix.length) }
    throw new Error(`Unknown Composio user id: ${composioUserId}`)
  }

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
      this.client = createComposioClient(key, this.dataDir)
      this.currentKey = key
      this.cache = undefined
      this.catalog = undefined
      this.tools.clear()
      this.expiredAccounts.clear()
    }
    return this.client
  }

  private composioUserId(account: Pick<ScopedConnection, 'scope' | 'userId'>): string {
    if (account.scope === 'workspace') return this.workspaceUserId
    if (!account.userId) throw new Error('Member connection has no user id')
    return this.memberUserId(account.userId)
  }

  async listConnections(fresh = false): Promise<ScopedConnection[]> {
    if (!this.configured()) return []
    const client = this.getClient()
    if (!fresh && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.rows
    const memberIds = (await this.db.select({ id: users.id }).from(users)).map(({ id }) => this.memberUserId(id))
    const remote = await client.connections([this.workspaceUserId, ...memberIds])
    const rows = remote.map((row): ScopedConnection => {
      const owner = this.scopeOf(row.userId)
      return { id: row.id, toolkit: row.toolkit, status: this.expiredAccounts.has(row.id) ? 'EXPIRED' : row.status, createdAt: row.createdAt, scope: owner.scope, userId: owner.scope === 'member' ? owner.userId : null }
    })
    const clear = this.db.delete(connections)
    if (rows.length) {
      await this.db.batch([clear, this.db.insert(connections).values(rows.map((row) => ({
        id: createId('connection'), provider: 'composio', toolkit: row.toolkit,
        composioConnectedAccountId: row.id, status: row.status, createdAt: row.createdAt,
        scope: row.scope, userId: row.userId,
      })))])
    } else await clear
    this.cache = { at: Date.now(), rows }
    return rows
  }

  private resolveFrom(rows: ScopedConnection[], toolkit: string, actorUserId: string | null): ScopedConnection | undefined {
    if (actorUserId) {
      const personal = rows.find((row) => row.toolkit === toolkit && row.scope === 'member' && row.userId === actorUserId && row.status === 'ACTIVE')
      if (personal) return personal
    }
    return rows.find((row) => row.toolkit === toolkit && row.scope === 'workspace' && row.status === 'ACTIVE')
  }

  async resolve(toolkit: string, actorUserId: string | null, fresh = false): Promise<ScopedConnection | undefined> {
    return this.resolveFrom(await this.listConnections(fresh), toolkit, actorUserId)
  }

  async connected(toolkit: string, actorUserId: string | null, fresh = false): Promise<boolean> {
    return Boolean(await this.resolve(toolkit, actorUserId, fresh))
  }

  async search(query: string, actorUserId: string | null, includeUnconnected = false) {
    const client = this.getClient()
    const accounts = await this.listConnections()
    const connected = new Set([...new Set(accounts.map((item) => item.toolkit))].filter((toolkit) => this.resolveFrom(accounts, toolkit, actorUserId)))
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

  async execute(slug: string, args: Record<string, unknown>, actorUserId: string | null): Promise<unknown> {
    const metadata = await this.metadata(slug)
    const account = await this.resolve(metadata.toolkit, actorUserId, true)
    const expired = () => new ConnectionRequiredError({ source: 'composio', toolkit: metadata.toolkit, appName: appName(metadata.toolkit) })
    if (!account) throw expired()
    const isExpired = (value: unknown) => /not[ _-]?connected|connection.*expired|account.*expired|connected.account.*(?:invalid|not found)|\b40[13]\b/i.test(value instanceof Error ? value.message : JSON.stringify(value))
    try {
      const result = await this.getClient().execute(slug, args, { userId: this.composioUserId(account), connectedAccountId: account.id, version: metadata.version })
      if (result && typeof result === 'object' && ('successful' in result && result.successful === false || 'error' in result && result.error) && isExpired(result)) throw expired()
      return result
    } catch (error) {
      if (error instanceof ConnectionRequiredError || isExpired(error)) {
        this.expiredAccounts.add(account.id)
        this.cache = undefined
        await this.db.update(connections).set({ status: 'EXPIRED' }).where(eq(connections.composioConnectedAccountId, account.id))
        throw expired()
      }
      throw error
    }
  }

  async verifyConnection(toolkit: string, scope: ConnectionScope, userId?: string) {
    if (scope === 'member' && !userId) throw new Error('Member connection requires a user id')
    const composioUserId = scope === 'workspace' ? this.workspaceUserId : this.memberUserId(userId!)
    const active = (await this.getClient().connections([composioUserId])).filter((item) => item.toolkit === toolkit && item.status === 'ACTIVE')
    if (!active.length) throw new Error('Connection is not active yet')
    for (const account of active) this.expiredAccounts.delete(account.id)
    this.cache = undefined
  }

  async disconnect(id: string) {
    const client = this.getClient()
    if (!client.disconnect) throw new Error('Disconnect is unavailable')
    if (!(await this.listConnections(true)).some((item) => item.id === id)) throw new Error('Connection not found')
    await client.disconnect(id)
    this.expiredAccounts.delete(id)
    this.cache = undefined
  }

  /** Repeated connect clicks may leave failed accounts behind; only clean the target identity. */
  private async forgetStale(client: ComposioClient, toolkit: string, composioUserId: string) {
    if (!client.disconnect) return
    try {
      for (const row of await client.connections([composioUserId])) {
        if (row.toolkit !== toolkit || !['INITIATED', 'FAILED', 'EXPIRED'].includes(row.status)) continue
        try { await client.disconnect(row.id) } catch { console.warn(`Composio account ${row.id} could not be removed before linking ${toolkit}`) }
      }
    } catch { console.warn(`Composio accounts for ${toolkit} could not be listed before linking`) }
  }

  async link(toolkit: string, target: ConnectionTarget, roomId?: string, callbackUrl?: string) {
    const client = this.getClient()
    const composioUserId = target.scope === 'workspace' ? this.workspaceUserId : this.memberUserId(target.userId)
    await this.forgetStale(client, toolkit, composioUserId)
    const result = await client.link(toolkit, composioUserId, callbackUrl)
    if (!['https:', 'http:'].includes(new URL(result.redirectUrl).protocol)) throw new Error('Invalid connection URL')
    this.cache = undefined
    if (roomId) await this.admission.post({ roomId, authorKind: 'system', authorId: null, actorUserId: target.scope === 'member' ? target.userId : null, text: `Connect ${toolkit}: ${result.redirectUrl}`, planReplies: false })
    return result
  }

  async marketplace(query: string, actorUserId: string | null) {
    const catalog = await this.catalogPage(query, 24, actorUserId)
    const text = query.toLowerCase()
    return { ...catalog, toolkits: catalog.toolkits.filter((item) => `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(text)) }
  }

  async catalogPage(query = '', limit = 24, actorUserId: string | null = null) {
    if (!this.configured()) return { configured: false, toolkits: [], version: 'unconfigured', total: 0, warming: false }
    const client = this.getClient()
    this.catalog ??= new ComposioCatalog(client)
    const [snapshot, accounts] = await Promise.all([this.catalog.read(query, limit), this.listConnections()])
    return {
      configured: true, version: snapshot.version, total: snapshot.total, warming: snapshot.warming,
      toolkits: snapshot.rows.map((item) => {
        const account = this.resolveFrom(accounts, item.slug, actorUserId)
        const relevant = accounts.filter((row) => row.toolkit === item.slug && (row.scope === 'workspace' || actorUserId !== null && row.userId === actorUserId))
        return { ...item, connected: Boolean(account), expired: !account && relevant.some((row) => ['EXPIRED', 'FAILED'].includes(row.status)), ...(account ? { scope: account.scope } : {}) }
      }),
    }
  }
}
