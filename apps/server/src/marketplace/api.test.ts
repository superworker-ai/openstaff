import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { MarketplaceAppsPage, MarketplaceSkillsPage } from '@openstaff/shared'
import { startServer } from '../app.js'
import { plugins } from '../db/schema.js'
import { marketplaceClient, skillRows, toolkitRows } from '../test/marketplace-fixtures.js'
import { decodeCursor } from './pagination.js'

it('serves authenticated cold pages without waiting for the catalog, then paginates the merged revision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marketplace-api-'))
  const client = marketplaceClient()
  let finish!: (rows: typeof toolkitRows) => void
  client.toolkits = vi.fn(() => new Promise<typeof toolkitRows>((resolve) => { finish = resolve }))
  client.connections = async () => [{ id: 'active', toolkit: 'app-005', status: 'ACTIVE', createdAt: new Date().toISOString() }, { id: 'expired', toolkit: 'app-010', status: 'EXPIRED', createdAt: new Date().toISOString() }]
  const running = await startServer({ config: { dataDir: directory, port: 0, signupCode: '' }, composioClient: client })
  const entries = [...skillRows, { name: 'app-plugin', source: './app-plugin', hasMcp: true, manifest: { name: 'app-plugin', displayName: 'App 020' } }]
  vi.spyOn(running.dependencies.installer.marketplace, 'snapshot').mockReturnValue({ entries, warming: false })
  vi.spyOn(running.dependencies.registry.oauth, 'list').mockResolvedValue([])
  try {
    expect((await running.app.request('/api/marketplace/apps')).status).toBe(401)
    const signup = await running.app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Owner', email: 'market@example.com', password: 'password123' }) })
    const headers = { cookie: signup.headers.get('set-cookie')!.split(';')[0]! }
    const apps = async (params = '') => (await running.app.request(`/api/marketplace/apps${params}`, { headers })).json() as Promise<MarketplaceAppsPage>
    const cold = await apps()
    expect(cold).toMatchObject({ warming: true, configured: true, total: 70, nextCursor: null })
    expect(cold.apps).toHaveLength(24)
    expect((await apps('?q=App%2006')).apps).toHaveLength(10)
    expect(client.toolkitPage).toHaveBeenCalledTimes(2)
    finish(toolkitRows)
    await vi.waitFor(async () => expect((await apps()).warming).toBe(false))
    await running.database.db.insert(plugins).values({ id: 'plugin-test', name: 'app-plugin', source: 'marketplace:app-plugin', rootPath: path.join(directory, 'unused'), manifest: { name: 'app-plugin', displayName: 'App 020', mcpServers: 'mcp.json' }, enabled: true, variables: running.dependencies.secrets.encrypt('{}'), installedAt: new Date().toISOString() })
    const first = await apps()
    expect(first.apps.slice(0, 3).map((app) => [app.slug, app.status])).toEqual([['app-005', 'Connected'], ['app-010', 'Expired'], ['app-020', 'Installed, not connected']])
    expect(first.total).toBe(70)
    expect(first.apps[2]?.plugins).toEqual([{ name: 'app-plugin', id: 'plugin-test' }])
    const second = await apps(`?cursor=${first.nextCursor}`)
    expect(second.apps).toHaveLength(24)
    expect(new Set([...first.apps, ...second.apps].map((app) => app.slug)).size).toBe(48)
    expect((await apps(`?cursor=${second.nextCursor}`)).apps).toHaveLength(22)
    expect((await apps('?limit=999')).apps).toHaveLength(60)
    expect((await apps('?q=app-plugin')).apps[0]?.slug).toBe('app-020')
    expect(client.toolkitPage).toHaveBeenCalledTimes(2)
    // A changed catalog invalidates old offsets and returns a newly computed cursor.
    client.toolkits = async () => [...toolkitRows, { slug: 'new', name: 'New app', description: '' }]
    running.dependencies.composio.refreshCatalog()
    await vi.waitFor(async () => expect((await apps()).total).toBe(71))
    const restarted = await apps(`?cursor=${second.nextCursor}`)
    expect(restarted.apps[0]?.slug).toBe(first.apps[0]?.slug)
    const cursor = JSON.parse(Buffer.from(restarted.nextCursor!, 'base64url').toString())
    expect(decodeCursor(restarted.nextCursor!, '', cursor.version)).toBe(24)
    const skills = await (await running.app.request('/api/marketplace/skills?limit=24', { headers })).json() as MarketplaceSkillsPage
    expect(skills).toMatchObject({ total: 70, warming: false, configured: true })
    expect(skills.skills).toHaveLength(24)
    const next = await (await running.app.request(`/api/marketplace/skills?cursor=${skills.nextCursor}`, { headers })).json() as MarketplaceSkillsPage
    expect(next.skills[0]?.name).toBe('skill-024')
  } finally { finish(toolkitRows); await running.stop(); await fs.rm(directory, { recursive: true, force: true }); vi.restoreAllMocks() }
})
