import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { fakeOAuthServer, writeOAuthPlugin } from '../test/fake-oauth.js'
import { Secrets } from '../secrets.js'
import { PluginInstaller } from './installer.js'
import { PluginRegistry } from './registry.js'
import { ConnectionHealth } from './connection-health.js'

afterEach(() => vi.useRealTimers())
it('checks every 30 minutes, refreshes within one hour, and broadcasts persisted expiry on refresh failure', async () => {
  const f = await fixture(), fake = await fakeOAuthServer(), secrets = new Secrets(randomBytes(32)), registry = new PluginRegistry(f.db, secrets)
  const hub = { broadcastAll: vi.fn() }, health = new ConnectionHealth(registry.oauth, hub)
  try {
    const id = await new PluginInstaller(f.db, f.directory, secrets, registry).install(`path:${await writeOAuthPlugin(f.directory, fake.url)}`)
    const provider = await registry.oauth.server(id, 'Gmail')
    await provider.saveClientInformation({ client_id: 'health-client' })
    await provider.saveAuthorizationServerInformation({ issuer: fake.url, authorizationServerUrl: fake.url, tokenEndpoint: `${fake.url}/token` })
    await provider.saveTokens({ access_token: 'access-initial', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 7200 })
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    health.start()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await health.check()
    expect(fake.grants).toHaveLength(0)
    expect(hub.broadcastAll).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'connection.updated', status: 'connected', lastCheckedAt: new Date().toISOString() }))
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await health.check()
    expect(fake.grants).toHaveLength(1)
    expect(fake.grants[0]?.get('grant_type')).toBe('refresh_token')
    expect(await provider.tokens()).toMatchObject({ access_token: 'access-refreshed-1', refresh_token: 'refresh-secret' })
    await provider.saveTokens({ access_token: 'access-refreshed-1', refresh_token: 'revoked', token_type: 'Bearer', expires_in: 1800 })
    await health.check()
    expect(await provider.connected()).toBe(false)
    expect(await provider.row()).toMatchObject({ tokens: null, refreshError: expect.any(String), lastCheckedAt: new Date().toISOString() })
    expect(hub.broadcastAll).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'connection.updated', app: 'Gmail', status: 'expired', error: expect.any(String) }))
    expect((await registry.oauth.servers(id))[0]?.status).toBe('Expired')
    await health.stop()
    expect(vi.getTimerCount()).toBe(0)
  } finally { await health.stop(); vi.useRealTimers(); await registry.mcpPool.close(); await fake.stop(); await f.close() }
})

it('health scans do not overlap or interrupt a pending OAuth consent flow', async () => {
  const f = await fixture(), fake = await fakeOAuthServer({ dcr: true }), secrets = new Secrets(randomBytes(32)), registry = new PluginRegistry(f.db, secrets)
  const hub = { broadcastAll: vi.fn() }, health = new ConnectionHealth(registry.oauth, hub)
  try {
    const id = await new PluginInstaller(f.db, f.directory, secrets, registry).install(`path:${await writeOAuthPlugin(f.directory, fake.url)}`)
    const provider = await registry.oauth.server(id, 'Gmail')
    await provider.saveTokens({ access_token: 'old', token_type: 'Bearer', expires_in: 10 })
    await provider.saveState('consent-in-progress')
    const first = health.check()
    expect(health.check()).toBe(first)
    await first
    expect(hub.broadcastAll).not.toHaveBeenCalled()
    expect((await provider.row())?.state).toBe('consent-in-progress')
    expect(fake.grants).toHaveLength(0)
  } finally { await health.stop(); await registry.mcpPool.close(); await fake.stop(); await f.close() }
})
