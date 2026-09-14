import { randomBytes } from 'node:crypto'
import { auth } from '@ai-sdk/mcp'
import { afterEach, expect, it, vi } from 'vitest'
import { oauthClients, pluginOAuth, plugins } from '../db/schema.js'
import { connectionError } from '@openstaff/shared'
import { Secrets } from '../secrets.js'
import { fixture } from '../test/fixture.js'
import { fakeOAuthServer } from '../test/fake-oauth.js'
import { CursorMarketplace } from './marketplace.js'
import { connectPluginServer, describeServerAuth, PluginOAuthProvider } from './oauth.js'

afterEach(() => vi.unstubAllEnvs())
async function setup() {
  const f = await fixture(), fake = await fakeOAuthServer(), secrets = new Secrets(randomBytes(32))
  await f.db.insert(plugins).values({ id: 'gmail', name: 'gmail', source: 'test', rootPath: f.directory, manifest: { name: 'gmail' }, enabled: true, variables: secrets.encrypt('{}'), installedAt: new Date().toISOString() })
  const open = () => PluginOAuthProvider.open(f.db, secrets, 'gmail', 'mail', `${fake.url}/mcp/v1`, 'http://localhost:3000')
  return { ...f, fake, secrets, open, close: async () => { await fake.stop(); await f.close() } }
}
it('OAuth provider persists clients, tokens, verifier, state, scopes and issuer encrypted at rest where required', async () => {
  const f = await setup()
  try {
    const provider = await f.open()
    await provider.saveClientInformation({ client_id: 'client-private', client_secret: 'secret-private' })
    await provider.saveTokens({ access_token: 'access-private', refresh_token: 'refresh-private', token_type: 'Bearer', expires_in: 60 })
    await provider.saveCodeVerifier('verifier-private'); await provider.saveState('pending-state'); await provider.setScopes(['mail.read'])
    await provider.saveAuthorizationServerInformation({ issuer: f.fake.url, authorizationServerUrl: f.fake.url, tokenEndpoint: `${f.fake.url}/token` })
    const restored = await f.open(), row = (await f.db.select().from(pluginOAuth))[0]!
    for (const field of ['clientInformation', 'tokens', 'codeVerifier'] as const) { expect(row[field]).toMatch(/^v1\./); expect(row[field]).not.toContain('private') }
    expect(await restored.clientInformation()).toEqual({ client_id: 'client-private', client_secret: 'secret-private' })
    expect(await restored.tokens()).toMatchObject({ access_token: 'access-private', refresh_token: 'refresh-private' })
    expect((await restored.tokens())!.expires_at).toBeGreaterThan(Date.now())
    expect(await restored.codeVerifier()).toBe('verifier-private'); expect(await restored.storedState()).toBe('pending-state')
    expect(restored.clientMetadata).toMatchObject({ token_endpoint_auth_method: 'client_secret_post', scope: 'mail.read', redirect_uris: ['http://localhost:3000/api/plugins/oauth/callback'] })
    await restored.saveTokens({ access_token: 'new-access', token_type: 'Bearer' })
    expect((await restored.tokens())?.refresh_token).toBe('refresh-private')
    await restored.invalidateCredentials('tokens'); expect(await restored.tokens()).toBeUndefined(); expect(await restored.clientInformation()).toBeDefined()
    await restored.invalidateCredentials('verifier'); expect(await restored.storedState()).toBeUndefined(); await expect(restored.codeVerifier()).rejects.toThrow('expired')
    await restored.invalidateCredentials('all'); expect(await restored.clientInformation()).toBeUndefined(); expect(await restored.authorizationServerInformation()).toBeUndefined()
  } finally { await f.close() }
})
it('Google authorization URL adds offline access and consent without redirecting', async () => {
  const f = await setup()
  try {
    const provider = await f.open()
    await provider.saveAuthorizationServerInformation({ issuer: 'https://accounts.google.com/', authorizationServerUrl: 'https://accounts.google.com/', tokenEndpoint: 'https://oauth2.googleapis.com/token' })
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth?state=keep&code_challenge=keep')
    await provider.redirectToAuthorization(url)
    expect(new URL(provider.authorizationUrl!).searchParams.get('access_type')).toBe('offline')
    expect(new URL(provider.authorizationUrl!).searchParams.get('prompt')).toBe('consent')
    expect(new URL(provider.authorizationUrl!).searchParams.get('state')).toBe('keep')
  } finally { await f.close() }
})
it('OAuth rejects mismatched, expired and replayed state and unadvertised authorization servers', async () => {
  const f = await setup()
  try {
    const provider = await f.open()
    await provider.saveClientInformation({ client_id: 'test' })
    await connectPluginServer(provider, ['mail.read'])
    const state = await provider.storedState()
    expect(state).toHaveLength(43)
    await expect(auth(provider, { serverUrl: provider.serverUrl, authorizationCode: 'bad', callbackState: 'wrong' })).rejects.toThrow('state parameter mismatch')
    expect(f.fake.grants).toHaveLength(0)
    await expect(provider.claimState('wrong')).rejects.toThrow('state')
    await provider.claimState(state!)
    await expect((await f.open()).claimState(state!)).rejects.toThrow('state')
    await provider.saveState('old'); await f.db.update(pluginOAuth).set({ updatedAt: new Date(0).toISOString() })
    await expect(provider.claimState('old')).rejects.toThrow('expired')
    await expect(provider.validateAuthorizationServerURL(provider.serverUrl, 'https://evil.example')).rejects.toThrow('not allowed')
    await expect(provider.validateAuthorizationServerURL(provider.serverUrl, f.fake.url)).resolves.toBeUndefined()
  } finally { await f.close() }
})
it.each([{ rootMetadata: false, dcr: false }, { rootMetadata: true, dcr: true }])('OAuth discovery uses path then root and detects dynamic registration: %j', async (options) => {
  const fake = await fakeOAuthServer(options)
  try {
    const result = await describeServerAuth(`${fake.url}/mcp/v1`)
    expect(result).toMatchObject({ protected: true, authorizationServer: fake.url, scopes: ['mail.read', 'mail.write'], supportsDynamicRegistration: options.dcr })
    expect(fake.requests[0]).toBe('GET /.well-known/oauth-protected-resource/mcp/v1')
    if (options.rootMetadata) expect(fake.requests[1]).toBe('GET /.well-known/oauth-protected-resource')
    const count = fake.requests.length
    expect(await describeServerAuth(`${fake.url}/mcp/v1`)).toBe(result)
    expect(fake.requests).toHaveLength(count)
  } finally { await fake.stop() }
})
it('OAuth discovery treats absent metadata as unprotected', async () => {
  const fake = await fakeOAuthServer({ unprotected: true })
  try { expect(await describeServerAuth(`${fake.url}/mcp/v1`)).toMatchObject({ protected: false, supportsDynamicRegistration: false, authorizationServer: null }) }
  finally { await fake.stop() }
})

it('Marketplace OAuth tags discover protected servers from a file-backed MCP configuration', async () => {
  const fake = await fakeOAuthServer()
  try {
    const marketplace = new CursorMarketplace(`${fake.url}/.cursor-plugin/marketplace.json`)
    expect(await marketplace.entries()).toMatchObject([{ name: 'gmail', oauth: true }])
  } finally { await fake.stop() }
})

it('manual OAuth clients are encrypted once and reused per issuer across plugins', async () => {
  const f = await setup()
  try {
    const first = await f.open()
    await first.saveWorkspaceClient({ client_id: 'shared-client', client_secret: 'shared-secret' })
    const second = await PluginOAuthProvider.open(f.db, f.secrets, 'drive', 'Drive', `${f.fake.url}/mcp/v1`, 'http://localhost:3000')
    expect(await second.clientInformation()).toEqual({ client_id: 'shared-client', client_secret: 'shared-secret' })
    const rows = await f.db.select().from(oauthClients)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.clientSecret).toMatch(/^v1\./)
    expect(rows[0]?.clientSecret).not.toContain('shared-secret')
  } finally { await f.close() }
})

it.each([
  ['redirect_uri_mismatch', 'Add exactly this redirect URI to the OAuth client'],
  ['invalid_client', 'Client ID or secret is wrong'],
  ['access_denied', 'You declined the consent screen'],
])('maps OAuth error %s to plain language', (code, message) => { expect(connectionError(new Error(code))).toBe(message) })
