import fs from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { eq } from 'drizzle-orm'
import { browserHarness } from '../test/browser-harness.js'
import { fakeOAuthServer, writeOAuthPlugin } from '../test/fake-oauth.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { oauthClients, plugins, turns } from '../db/schema.js'

describe.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('connection flows in the browser', () => {
  let h: Awaited<ReturnType<typeof browserHarness>>, fake: Awaited<ReturnType<typeof fakeOAuthServer>>, manual: Awaited<ReturnType<typeof fakeOAuthServer>>
  let pluginId: string
  let composioActive = false
  const errors: string[] = []
  let model: MockLanguageModelV3
  beforeAll(async () => {
    fake = await fakeOAuthServer({ dcr: true })
    manual = await fakeOAuthServer()
    model = new MockLanguageModelV3({ doStream: [
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'connect-mail', toolName: 'request_connection', input: '{"app":"Gmail"}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'read-mail', toolName: 'gmail__read_mail', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      textStream('Your inbox says hello from fake OAuth.'),
    ] })
    h = await browserHarness({ hostname: 'localhost', modelResolver: () => model, composioClient: {
      connections: async () => composioActive ? [{ id: 'hubspot-account', toolkit: 'hubspot', status: 'ACTIVE', createdAt: new Date().toISOString() }] : [], search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), execute: async () => ({}), link: async (_toolkit, callback) => { composioActive = true; return { redirectUrl: callback! } },
      toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: 'Read, organize, and reply to email.' }, { slug: 'googledrive', name: 'Google Drive', description: 'Find and work with your documents.' }, { slug: 'github', name: 'GitHub', description: 'Work with repositories and issues.' }],
    } })
    h.page.on('pageerror', (error) => errors.push(error.message))
    await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await h.page.getByRole('link', { name: 'Create account', exact: true }).click()
    await h.page.getByPlaceholder('Your name').fill('Connections Owner')
    await h.page.getByPlaceholder('Email', { exact: true }).fill('connections@example.com')
    await h.page.getByPlaceholder('Password', { exact: true }).fill('password123')
    await h.page.getByRole('button', { name: 'Create account', exact: true }).click()
    await h.page.waitForURL('**/bots/new', { waitUntil: 'domcontentloaded' })
    const root = await writeOAuthPlugin(h.api.config.dataDir, fake.url)
    const entries = [{ name: 'gmail', source: './gmail', hasMcp: true, manifest: { name: 'gmail', displayName: 'Gmail', description: 'Read, organize, and reply to email.' } }, { name: 'google-drive', source: './drive', hasMcp: true, manifest: { name: 'google-drive', displayName: 'Google Drive', description: 'Find and work with your documents.' } }, { name: 'github', source: './github', hasMcp: true, manifest: { name: 'github', displayName: 'GitHub', description: 'Work with repositories and issues.' } }]
    vi.spyOn(h.api.dependencies.installer.marketplace, 'entries').mockResolvedValue(entries)
    vi.spyOn(h.api.dependencies.installer.marketplace, 'snapshot').mockReturnValue({ entries, warming: false })
    const install = h.api.dependencies.installer.install.bind(h.api.dependencies.installer)
    vi.spyOn(h.api.dependencies.installer, 'install').mockImplementation((source) => install(source === 'marketplace:gmail' ? `path:${root}` : source))
    await fs.mkdir('/tmp/shots-connections', { recursive: true })
    await fs.mkdir('/tmp/shots-connections-2', { recursive: true })
  }, 40_000)
  afterAll(async () => { vi.restoreAllMocks(); await h?.stop(); await fake?.stop(); await manual?.stop() })

  it('install opens Connect, DCR popup closes, and the dialog receives Connected', async () => {
    const { page, context, url } = h
    await page.getByRole('navigation', { name: 'First-run checklist' }).waitFor()
    await page.goto(`${url}/marketplace`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Gmail', exact: true }).waitFor()
    expect(await page.getByRole('tab', { name: 'Apps', exact: true }).getAttribute('aria-selected')).toBe('true')
    await page.screenshot({ path: '/tmp/shots-connections/apps-catalog.png', fullPage: true })
    await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Gmail', exact: true }) }).getByRole('button', { name: 'Install plugin' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect app' })
    await dialog.waitFor()
    const opened = context.waitForEvent('page')
    await dialog.getByRole('button', { name: 'Connect Gmail', exact: true }).click()
    const popup = await opened
    await vi.waitFor(() => expect(popup.isClosed()).toBe(true))
    await dialog.getByRole('status').filter({ hasText: 'Connected' }).waitFor()
    pluginId = (await h.api.database.db.select().from(plugins).where(eq(plugins.name, 'gmail')))[0]!.id
    expect(fake.registrations).toHaveLength(1)
    expect((await context.cookies(url)).some((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true)
    expect(popup.isClosed()).toBe(true)
    await dialog.getByRole('button', { name: 'Close connection dialog' }).click()
    expect(errors).toEqual([])
  }, 20_000)

  it('/connect creates a card without a model call; welcome chips and Members apps render; popup reconnect resumes the bot', async () => {
    await (await h.api.dependencies.registry.oauth.server(pluginId, 'Gmail')).invalidateCredentials('tokens')
    const response = await h.context.request.post(`${h.url}/api/bots`, { data: { templateId: 'growth', name: 'Mail teammate', job: 'Email assistant', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' } })
    const { room } = await response.json() as { room: { id: string } }
    await h.page.goto(`${h.url}/rooms/${room.id}`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await h.page.getByRole('button', { name: 'Members' }).click()
    await h.page.getByText('present', { exact: true }).waitFor()
    await h.page.keyboard.press('Escape')
    await h.page.locator('.message-markdown').getByText('I work best with', { exact: false }).waitFor()
    await h.page.getByRole('button', { name: 'Gmail · not connected', exact: true }).first().waitFor()
    expect(model.doStreamCalls).toHaveLength(0)
    await h.page.screenshot({ path: '/tmp/shots-connections-2/new-bot-welcome.png', fullPage: true })
    const members = h.page.getByRole('region', { name: 'Room apps' })
    await members.getByRole('button', { name: 'Gmail · not connected' }).waitFor()
    await h.page.screenshot({ path: '/tmp/shots-connections-2/members-apps.png', fullPage: true })
    const composer = h.page.getByPlaceholder('Message Mail teammate', { exact: true })
    await composer.fill('/connect ')
    await h.page.getByRole('listbox', { name: 'Connect an app' }).waitFor()
    await h.page.screenshot({ path: '/tmp/shots-connections-2/connect-autocomplete.png', fullPage: true })
    const commandPopup = h.context.waitForEvent('page')
    await composer.fill('/connect Google Mail')
    await composer.press('Enter')
    const cancelledPopup = await commandPopup
    await cancelledPopup.getByRole('button', { name: 'Connect Gmail', exact: true }).waitFor()
    const initialCard = h.page.getByTestId('connect-card').first()
    await initialCard.getByText('Mail teammate needs Gmail connected', { exact: true }).waitFor()
    expect(model.doStreamCalls).toHaveLength(0)
    await cancelledPopup.close()
    await initialCard.getByRole('button', { name: 'Not now' }).click()
    await initialCard.getByText('Not connected · Request declined', { exact: true }).waitFor()
    expect(model.doStreamCalls).toHaveLength(0)
    await composer.fill('Please read my Gmail inbox.')
    await composer.press('Enter')
    const card = h.page.getByTestId('connect-card').last()
    await card.getByText('Mail teammate needs Gmail connected', { exact: true }).waitFor()
    expect(fake.toolCalls).toHaveLength(0)
    await h.page.screenshot({ path: '/tmp/shots-connections-2/connect-card.png', fullPage: true })
    const opened = h.context.waitForEvent('page')
    await composer.fill('/connect Gmail')
    await composer.press('Enter')
    const popup = await opened
    await popup.getByRole('button', { name: 'Connect Gmail', exact: true }).click()
    await vi.waitFor(() => expect(popup.isClosed()).toBe(true))
    await h.page.locator('.message-markdown').getByText('Your inbox says hello from fake OAuth.', { exact: true }).waitFor()
    await vi.waitFor(async () => expect((await h.api.database.db.select().from(turns).where(eq(turns.roomId, room.id))).find((turn) => turn.replyMode === 'direct' && turn.modelMessages.length > 0)?.status).toBe('done'))
    expect(fake.toolCalls).toHaveLength(1)
    await card.getByText('Connected · Continuing conversation', { exact: true }).waitFor()
    await members.getByRole('button', { name: 'Gmail · connected', exact: true }).waitFor()
    expect(h.page.url()).toBe(`${h.url}/rooms/${room.id}`)
    const provider = await h.api.dependencies.registry.oauth.server(pluginId, 'Gmail')
    await provider.markExpired('Test refresh failure')
    h.api.dependencies.hub.broadcastAll({ type: 'connection.updated', app: 'Gmail', status: 'expired', ts: new Date().toISOString() })
    await members.getByRole('button', { name: 'Gmail · expired', exact: true }).waitFor()
    expect(await members.locator('[data-status="expired"]').count()).toBe(1)
    await h.page.screenshot({ path: '/tmp/shots-connections-2/members-apps.png', fullPage: true })
    await provider.saveTokens({ access_token: 'access-initial', token_type: 'Bearer' })
    await h.api.dependencies.keys.set({ xai: 'fake-test-key' })
    expect(await (await h.context.request.get(`${h.url}/api/workspace/onboarding`)).json()).toMatchObject({ model: true, connected: true, hasBots: true, complete: true })
    await h.page.goto(`${h.url}/bots/new`, { waitUntil: 'domcontentloaded' })
    await h.page.getByRole('heading', { name: 'Meet a future teammate' }).waitFor()
    await vi.waitFor(async () => expect(await h.page.getByRole('navigation', { name: 'First-run checklist' }).count()).toBe(0))
    expect(popup.isClosed()).toBe(true)
    expect(errors).toEqual([])
  }, 20_000)

  it('manual-client guidance shows the redirect URI and saves one shared client for two plugins', async () => {
    const first = await h.api.dependencies.installer.install(`path:${await writeOAuthPlugin(h.api.config.dataDir, manual.url, 'manual-drive')}`)
    const second = await h.api.dependencies.installer.install(`path:${await writeOAuthPlugin(h.api.config.dataDir, manual.url, 'manual-calendar')}`)
    await h.page.goto(`${h.url}/connect/${first}/Gmail`, { waitUntil: 'domcontentloaded' })
    await h.page.getByText(`${h.url}/api/plugins/oauth/callback`, { exact: true }).waitFor()
    expect(await h.page.locator('ol li').count()).toBe(3)
    await h.page.getByLabel('Client ID', { exact: true }).fill('shared-browser-client')
    await h.page.getByLabel('Client secret', { exact: true }).fill('shared-browser-secret')
    await h.page.getByRole('button', { name: 'Connect Gmail', exact: true }).click()
    await h.page.getByRole('status').filter({ hasText: 'Connected' }).waitFor()
    await h.page.goto(`${h.url}/connect/${second}/Gmail`, { waitUntil: 'domcontentloaded' })
    await h.page.getByRole('button', { name: 'Connect Gmail', exact: true }).waitFor()
    expect(await h.page.getByLabel('Client ID', { exact: true }).count()).toBe(0)
    expect(await h.api.database.db.select().from(oauthClients)).toHaveLength(1)
    expect(manual.grants[0]?.get('client_secret')).toBe('shared-browser-secret')
    expect(errors).toEqual([])
  }, 20_000)

  it('Composio onboarding saves a key inside the connect card and completes in a popup without a model call', async () => {
    vi.stubEnv('COMPOSIO_API_KEY', '')
    await h.api.dependencies.keys.set({ composio: '' })
    expect(h.api.dependencies.keys.configured().composio).toBe(false)
    const configured = vi.spyOn(h.api.dependencies.composio, 'configured').mockImplementation(() => Boolean(h.api.dependencies.keys.get('composio')))
    try {
      const response = await h.context.request.post(`${h.url}/api/bots`, { data: { name: 'App helper', job: 'Apps', avatar: { shape: 'circle', color: '#2E90FA' } } })
      const { room } = await response.json() as { room: { id: string } }
      await h.context.request.post(`${h.url}/api/rooms/${room.id}/connect`, { data: { app: 'HubSpot' } })
      const calls = model.doStreamCalls.length
      await h.page.goto(`${h.url}/rooms/${room.id}`, { waitUntil: 'domcontentloaded' })
      await h.page.locator('body[data-hydrated="true"]').waitFor()
      await h.page.getByRole('button', { name: 'Members' }).click()
      await h.page.getByText('present', { exact: true }).waitFor()
      await h.page.keyboard.press('Escape')
      const card = h.page.getByTestId('connect-card')
      await card.getByRole('button', { name: 'Connect with Composio' }).click()
      await card.getByRole('link', { name: 'Get a Composio key' }).waitFor()
      await card.getByLabel('Composio key', { exact: true }).fill('fake-composio-key')
      const opened = h.context.waitForEvent('page')
      await card.getByRole('button', { name: 'Save and connect' }).click()
      const popup = await opened
      await vi.waitFor(() => expect(popup.isClosed()).toBe(true))
      await card.getByText('Connected · Continuing conversation', { exact: true }).waitFor()
      expect(h.api.dependencies.keys.get('composio')).toBe('fake-composio-key')
      expect(model.doStreamCalls).toHaveLength(calls)
      expect(h.page.url()).toBe(`${h.url}/rooms/${room.id}`)
      expect(errors).toEqual([])
    } finally { configured.mockRestore(); vi.unstubAllEnvs() }
  }, 20_000)
})
