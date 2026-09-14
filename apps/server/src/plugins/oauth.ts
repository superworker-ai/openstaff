import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { auth, type OAuthAuthorizationServerInformation, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens } from '@ai-sdk/mcp'
import { z } from 'zod'
import type { PluginServerAuth, ServerAuthDescription } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { pluginOAuth, plugins } from '../db/schema.js'
import type { Secrets } from '../secrets.js'
import { loadPlugin } from './loader.js'
import { OAuthClients } from './oauth-clients.js'

const resourceSchema = z.object({ resource: z.url(), authorization_servers: z.array(z.url()).default([]), scopes_supported: z.array(z.string()).default([]) })
const asSchema = z.object({ issuer: z.url(), authorization_endpoint: z.url(), token_endpoint: z.url(), registration_endpoint: z.url().optional() })
type Discovery = ServerAuthDescription & { resourceMetadataUrl?: string; authorizationServers: string[]; issuer?: string }
const cache = new Map<string, { until: number; result: Promise<Discovery> }>()

function httpUrl(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('OAuth URLs must use HTTPS (HTTP is allowed on loopback)')
  return url
}
async function metadata(url: URL): Promise<unknown | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'error' })
  if ([404, 405].includes(response.status)) return undefined
  if (!response.ok) throw new Error(`OAuth metadata request failed (${response.status})`)
  return response.json()
}
async function discover(serverUrl: string): Promise<Discovery> {
  const server = httpUrl(serverUrl), suffix = server.pathname.replace(/\/$/, '')
  let resource: z.infer<typeof resourceSchema> | undefined, resourceMetadataUrl: string | undefined
  for (const pathname of new Set([`/.well-known/oauth-protected-resource${suffix}`, '/.well-known/oauth-protected-resource'])) {
    const url = new URL(pathname, server)
    const result = await metadata(url)
    if (result !== undefined) { resource = resourceSchema.parse(result); resourceMetadataUrl = url.href; break }
  }
  if (!resource) return { protected: false, authorizationServer: null, scopes: [], supportsDynamicRegistration: false, authorizationServers: [] }
  const authorizationServer = resource.authorization_servers[0] ?? server.origin
  const issuer = httpUrl(authorizationServer), issuerPath = issuer.pathname.replace(/\/$/, '')
  let discovered: z.infer<typeof asSchema> | undefined
  for (const pathname of new Set([`/.well-known/oauth-authorization-server${issuerPath}`, `${issuerPath}/.well-known/openid-configuration`, '/.well-known/openid-configuration'])) {
    const result = await metadata(new URL(pathname, issuer))
    if (result !== undefined) { discovered = asSchema.parse(result); break }
  }
  if (discovered && discovered.issuer.replace(/\/$/, '') !== issuer.href.replace(/\/$/, '')) throw new Error('OAuth authorization server issuer mismatch')
  return { protected: true, authorizationServer, scopes: resource.scopes_supported, supportsDynamicRegistration: Boolean(discovered?.registration_endpoint), authorizationServers: resource.authorization_servers, issuer: discovered?.issuer, resourceMetadataUrl }
}
/** Path-first RFC 9728 discovery; cache successful discoveries, including unprotected servers. */
export function describeServerAuth(url: string): Promise<Discovery> {
  const cached = cache.get(url)
  if (cached && cached.until > Date.now()) return cached.result
  const result = discover(url).catch((error) => { cache.delete(url); throw error })
  cache.set(url, { until: Date.now() + 600_000, result })
  return result
}

export class PluginOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: string
  private client?: OAuthClientInformation
  private selectedScopes: string[] = []
  private callbackState?: string
  private checkingHealth = false
  readonly redirectUrl: string
  private constructor(private readonly db: Database, private readonly secrets: Secrets, readonly pluginId: string, readonly serverName: string, readonly serverUrl: string, readonly description: Discovery, publicAppUrl?: string) {
    this.redirectUrl = `${(publicAppUrl || process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/plugins/oauth/callback`
  }
  static async open(db: Database, secrets: Secrets, pluginId: string, serverName: string, serverUrl: string, publicAppUrl?: string) {
    const provider = new PluginOAuthProvider(db, secrets, pluginId, serverName, serverUrl, await describeServerAuth(serverUrl), publicAppUrl)
    const row = await provider.row()
    provider.client = await provider.clientInformation()
    provider.selectedScopes = row?.scopes ?? []
    return provider
  }
  private key() { return and(eq(pluginOAuth.pluginId, this.pluginId), eq(pluginOAuth.serverName, this.serverName)) }
  async row() { return (await this.db.select().from(pluginOAuth).where(this.key()))[0] }
  private async write(values: Partial<typeof pluginOAuth.$inferInsert>) {
    const update = { ...values, updatedAt: new Date().toISOString() }
    await this.db.insert(pluginOAuth).values({ pluginId: this.pluginId, serverName: this.serverName, ...update }).onConflictDoUpdate({ target: [pluginOAuth.pluginId, pluginOAuth.serverName], set: update })
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'OpenStaff', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: this.client?.client_secret ? 'client_secret_post' : 'none', ...(this.selectedScopes.length ? { scope: this.selectedScopes.join(' ') } : {}) }
  }
  async clientInformation() {
    const row = await this.row()
    this.client = await new OAuthClients(this.db, this.secrets).get(this.issuer) ?? (row?.clientInformation ? JSON.parse(this.secrets.decrypt(row.clientInformation)) : undefined)
    return this.client
  }
  get issuer() { return (this.description.issuer ?? this.description.authorizationServer ?? this.serverUrl).replace(/\/$/, '') }
  async saveWorkspaceClient(client: OAuthClientInformation) { await new OAuthClients(this.db, this.secrets).save(this.issuer, client); this.client = client }
  async setConnectionAttempt(approvalId?: string) { await this.write({ approvalId: approvalId ?? null, error: null }) }
  async setError(error: string | null) { await this.write({ error }) }
  async markExpired(error: string) { await this.write({ tokens: null, refreshError: error, lastCheckedAt: new Date().toISOString() }) }
  async disconnect() { await this.invalidateCredentials('tokens'); await this.invalidateCredentials('verifier'); await this.write({ error: null, refreshError: null }) }
  async checkHealth(now = Date.now()) {
    const row = await this.row(), tokens = await this.tokens()
    if (row?.state && now - Date.parse(row.updatedAt) < 600_000) return
    let refreshError: string | null = null
    if (tokens?.expires_at && tokens.expires_at <= now + 3_600_000) {
      this.checkingHealth = true
      try {
        if (!tokens.refresh_token) throw new Error('Refresh token is missing. Reconnect this app.')
        const result = await auth(this, { serverUrl: this.serverUrl, resourceMetadataUrl: this.description.resourceMetadataUrl ? new URL(this.description.resourceMetadataUrl) : undefined })
        if (result !== 'AUTHORIZED') throw new Error('Sign-in expired. Reconnect this app.')
      } catch (error) {
        refreshError = error instanceof Error ? error.message : 'Token refresh failed'
        await this.invalidateCredentials('tokens')
      } finally { this.checkingHealth = false }
    } else if (!tokens) refreshError = row?.refreshError ?? null
    const checked = { lastCheckedAt: new Date(now).toISOString(), refreshError }
    await this.db.insert(pluginOAuth).values({ pluginId: this.pluginId, serverName: this.serverName, updatedAt: row?.updatedAt ?? checked.lastCheckedAt, ...checked }).onConflictDoUpdate({ target: [pluginOAuth.pluginId, pluginOAuth.serverName], set: checked })
    return { status: refreshError ? 'expired' as const : await this.connected() ? 'connected' as const : 'not connected' as const, lastCheckedAt: new Date(now).toISOString(), error: refreshError }
  }
  async connected(): Promise<boolean> {
    const tokens = await this.tokens()
    return Boolean(tokens && (!tokens.expires_at || tokens.expires_at > Date.now()))
  }
  async ensureConnected(): Promise<boolean> {
    if (await this.connected()) return true
    const tokens = await this.tokens()
    if (!tokens?.refresh_token) return false
    this.checkingHealth = true
    try {
      const result = await auth(this, { serverUrl: this.serverUrl, resourceMetadataUrl: this.description.resourceMetadataUrl ? new URL(this.description.resourceMetadataUrl) : undefined })
      if (result === 'AUTHORIZED') return true
    } catch { /* A failed refresh needs a new human grant. */ }
    finally { this.checkingHealth = false }
    await this.markExpired('Token refresh failed. Reconnect this app.')
    return false
  }
  async saveClientInformation(client: OAuthClientInformation) { this.client = client; await this.write({ clientInformation: this.secrets.encrypt(JSON.stringify(client)) }) }
  async tokens(): Promise<(OAuthTokens & { expires_at?: number }) | undefined> {
    const row = await this.row()
    return row?.tokens ? JSON.parse(this.secrets.decrypt(row.tokens)) : undefined
  }
  async saveTokens(tokens: OAuthTokens) {
    const old = await this.tokens()
    await this.write({ error: null, refreshError: null, tokens: this.secrets.encrypt(JSON.stringify({ ...tokens, refresh_token: tokens.refresh_token ?? old?.refresh_token, expires_at: tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000 })) })
  }
  async saveCodeVerifier(value: string) { await this.write({ codeVerifier: this.secrets.encrypt(value) }) }
  async codeVerifier() {
    const row = await this.row()
    if (!row?.codeVerifier) throw new Error('OAuth connection expired. Connect again in Settings → Plugins.')
    return this.secrets.decrypt(row.codeVerifier)
  }
  state() { if (this.checkingHealth) throw new Error('Sign-in expired. Reconnect this app.'); return randomBytes(32).toString('base64url') }
  async saveState(state: string) { await this.write({ state }) }
  async storedState() { return this.callbackState ?? (await this.row())?.state ?? undefined }
  async claimState(state: string) {
    const row = await this.row()
    if (!row || row.state !== state || Date.now() - Date.parse(row.updatedAt) > 600_000) throw new Error('Invalid or expired OAuth state. Connect again in Settings → Plugins.')
    const claimed = await this.db.update(pluginOAuth).set({ state: null }).where(and(this.key(), eq(pluginOAuth.state, state))).returning()
    if (!claimed.length) throw new Error('OAuth state was already used')
    this.callbackState = state
  }
  async authorizationServerInformation() { return (await this.row())?.authorizationServer ?? undefined }
  async saveAuthorizationServerInformation(value: OAuthAuthorizationServerInformation) { await this.write({ authorizationServer: value }) }
  async validateAuthorizationServerURL(serverUrl: string | URL, authorizationServerUrl: string | URL) {
    if (String(serverUrl) !== this.serverUrl) throw new Error('Unexpected MCP server for OAuth')
    const url = httpUrl(String(authorizationServerUrl))
    const allowed = [...this.description.authorizationServers, this.description.issuer ?? this.serverUrl].map((value) => httpUrl(value).origin)
    if (!allowed.includes(url.origin)) throw new Error('OAuth authorization server is not allowed by resource metadata')
  }
  async redirectToAuthorization(url: URL) {
    const information = await this.authorizationServerInformation()
    if (new URL(information?.issuer ?? this.description.issuer ?? this.description.authorizationServer ?? this.serverUrl).hostname === 'accounts.google.com') {
      url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent')
    }
    this.authorizationUrl = url.href
  }
  async setScopes(scopes: string[]) { this.selectedScopes = scopes; await this.write({ scopes }) }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier') {
    const values: Partial<typeof pluginOAuth.$inferInsert> = {}
    if (scope === 'all' || scope === 'client') { values.clientInformation = null; this.client = undefined }
    if (scope === 'all' || scope === 'tokens') values.tokens = null
    if (scope === 'all' || scope === 'verifier') { values.codeVerifier = null; values.state = null; this.callbackState = undefined }
    if (scope === 'all') { values.authorizationServer = null; values.scopes = null }
    await this.write(values)
  }
}

export class ClientCredentialsRequired extends Error {
  constructor() { super('OAuth client credentials must be configured in Settings → Plugins before connecting this server. Register the displayed redirect URI in your OAuth client.'); this.name = 'ClientCredentialsRequired' }
}
export async function connectPluginServer(provider: PluginOAuthProvider, scopes?: string[]) {
  if (!await provider.clientInformation() && !provider.description.supportsDynamicRegistration) throw new ClientCredentialsRequired()
  const selected = scopes ?? (await provider.row())?.scopes ?? provider.description.scopes
  await provider.setScopes(selected)
  const result = await auth(provider, { serverUrl: provider.serverUrl, scope: selected.join(' ') || undefined, resourceMetadataUrl: provider.description.resourceMetadataUrl ? new URL(provider.description.resourceMetadataUrl) : undefined })
  if (result === 'REDIRECT' && provider.authorizationUrl) return { redirectUrl: provider.authorizationUrl }
  return { redirectUrl: new URL(`/settings?connected=${encodeURIComponent(`${provider.pluginId}/${provider.serverName}`)}`, provider.redirectUrl).href }
}

export class PluginOAuthService {
  readonly clients: OAuthClients
  constructor(private readonly db: Database, private readonly secrets: Secrets, private readonly publicAppUrl?: string) { this.clients = new OAuthClients(db, secrets) }
  async list() {
    const rows = await this.db.select().from(plugins)
    return (await Promise.all(rows.map(async (row) => ({ pluginId: row.id, appName: row.manifest.displayName ?? row.name, name: row.name, enabled: row.enabled, servers: await this.servers(row.id) })))).flatMap(({ servers, ...plugin }) => servers.map((server) => ({ ...plugin, ...server, serverName: server.name })))
  }
  async server(pluginId: string, serverName: string) {
    const row = (await this.db.select().from(plugins).where(eq(plugins.id, pluginId)))[0]
    if (!row) throw new Error('Plugin not found')
    const loaded = await loadPlugin(row.rootPath, JSON.parse(this.secrets.decrypt(row.variables)))
    const server = loaded.servers[serverName]
    if (!server || server.type === 'stdio') throw new Error('Remote plugin server not found')
    return PluginOAuthProvider.open(this.db, this.secrets, pluginId, serverName, server.url, this.publicAppUrl)
  }
  async forRuntime(pluginName: string, serverName: string, url: string) {
    const row = (await this.db.select().from(plugins).where(eq(plugins.name, pluginName)))[0]
    if (!row) return undefined
    const provider = await PluginOAuthProvider.open(this.db, this.secrets, row.id, serverName, url, this.publicAppUrl)
    return provider
  }
  async servers(pluginId: string): Promise<PluginServerAuth[]> {
    const row = (await this.db.select().from(plugins).where(eq(plugins.id, pluginId)))[0]
    if (!row) throw new Error('Plugin not found')
    const loaded = await loadPlugin(row.rootPath, JSON.parse(this.secrets.decrypt(row.variables)))
    return Promise.all(Object.entries(loaded.servers).filter(([, server]) => server.type !== 'stdio').map(async ([name, config]) => {
      try {
      const provider = await this.server(pluginId, name), description = provider.description
      const connected = await provider.connected(), state = await provider.row()
      return { name, url: provider.serverUrl, protected: description.protected, connected, auth: !description.protected && state?.refreshError ? 'unknown' as const : !description.protected ? 'none' as const : description.supportsDynamicRegistration ? 'dcr' as const : 'manual-client' as const, issuer: provider.issuer, lastCheckedAt: state?.lastCheckedAt, refreshError: state?.refreshError, error: state?.error, status: state?.refreshError ? 'Expired' as const : state?.error ? 'Error' as const : connected ? 'Connected' as const : await provider.tokens() ? 'Expired' as const : 'Not connected' as const, supportsDynamicRegistration: description.supportsDynamicRegistration, scopes: description.scopes, needsClientCredentials: description.protected && !description.supportsDynamicRegistration && !await provider.clientInformation(), redirectUri: provider.redirectUrl, authorizationServer: description.authorizationServer }
      } catch (error) { return { name, url: config.type === 'stdio' ? '' : config.url, protected: true, connected: false, auth: 'unknown' as const, issuer: null, error: error instanceof Error ? error.message : 'Discovery failed', status: 'Error' as const, supportsDynamicRegistration: false, scopes: [], needsClientCredentials: false, redirectUri: `${this.publicAppUrl || process.env.PUBLIC_APP_URL || 'http://localhost:3000'}/api/plugins/oauth/callback`, authorizationServer: null } }
    }))
  }
}
