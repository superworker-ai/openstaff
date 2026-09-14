import fs from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { browserHarness } from '../test/browser-harness.js'
import { marketplaceClient, skillRows } from '../test/marketplace-fixtures.js'

describe.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('paginated Marketplace in Chromium', () => {
  let h: Awaited<ReturnType<typeof browserHarness>>
  const client = marketplaceClient(), errors: string[] = []
  beforeAll(async () => {
    h = await browserHarness({ composioClient: client })
    vi.spyOn(h.api.dependencies.installer.marketplace, 'snapshot').mockReturnValue({ entries: skillRows, warming: false })
    h.page.on('pageerror', (error) => errors.push(error.message))
    const signup = await h.context.request.post(`${h.url}/api/auth/signup`, { data: { name: 'UI Owner', email: 'ui@example.com', password: 'password123' } })
    expect(signup.ok()).toBe(true)
  }, 45_000)
  afterAll(async () => { await h?.stop(); vi.restoreAllMocks() })

  const open = async () => {
    await h.page.goto(`${h.url}/marketplace`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await vi.waitFor(async () => expect(await h.page.getByTestId('marketplace-card').count()).toBe(24))
  }
  const count = async (n: number) => {
    await vi.waitFor(async () => expect(await h.page.getByTestId('marketplace-card').count()).toBe(n))
    expect(await h.page.getByTestId('marketplace-count').textContent()).toBe(`Showing ${n} of 70`)
  }

  it('loads 24, 48, then all 70 Apps by scrolling the sentinel and captures the mid-scroll grid', async () => {
    await open()
    await count(24)
    await h.page.getByRole('button', { name: 'Load more', exact: true }).waitFor()
    await h.page.getByTestId('marketplace-sentinel').scrollIntoViewIfNeeded()
    await count(48)
    await fs.mkdir('/tmp/shots-marketplace', { recursive: true })
    await h.page.screenshot({ path: '/tmp/shots-marketplace/apps-mid-scroll.png' })
    await h.page.getByTestId('marketplace-sentinel').scrollIntoViewIfNeeded()
    await count(70)
    expect(await h.page.getByRole('button', { name: 'Load more', exact: true }).count()).toBe(0)
    expect(client.toolkitPage).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })

  it('debounces server-side search to one request per window and echoes empty queries', async () => {
    await open()
    const searches: string[] = []
    const listener = (request: { url(): string }) => { const url = new URL(request.url()); if (url.pathname === '/api/marketplace/apps' && url.searchParams.get('q')) searches.push(url.searchParams.get('q')!) }
    h.page.on('request', listener)
    try {
      await h.page.getByRole('textbox', { name: 'Search marketplace' }).pressSequentially('App 06', { delay: 25 })
      await vi.waitFor(async () => expect(await h.page.getByTestId('marketplace-count').textContent()).toBe('Showing 10 of 10'))
      expect(await h.page.getByTestId('marketplace-card').count()).toBe(10)
      expect(searches).toEqual(['App 06'])
      await h.page.getByRole('textbox', { name: 'Search marketplace' }).fill('not-a-toolkit')
      await h.page.getByText('No results for “not-a-toolkit”.', { exact: true }).waitFor()
      expect(searches).toEqual(['App 06', 'not-a-toolkit'])
      expect(client.toolkitPage).not.toHaveBeenCalled()
    } finally { h.page.off('request', listener) }
  })

  it('paginates Skills, supports the Load more fallback, and installs without resetting pages or scroll', async () => {
    await open()
    await h.page.getByTestId('marketplace-tab-skills').click()
    await count(24)
    await h.page.getByTestId('marketplace-sentinel').scrollIntoViewIfNeeded()
    await count(48)
    // Dispatch keyboard-style activation without scrolling the button into the observer.
    await h.page.getByRole('button', { name: 'Load more', exact: true }).evaluate((button) => (button as HTMLButtonElement).click())
    await count(70)
    const requests: string[] = []
    h.page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/marketplace/skills') requests.push(request.url()) })
    await h.page.route('**/api/plugins/install', (route) => route.fulfill({ json: { plugin: { id: 'installed-skill' }, servers: [] } }))
    const card = h.page.getByTestId('marketplace-card').filter({ has: h.page.getByRole('heading', { name: 'skill-030', exact: true }) })
    await card.scrollIntoViewIfNeeded()
    const y = await h.page.evaluate(() => window.scrollY)
    await card.getByRole('button', { name: 'Install', exact: true }).click()
    await card.getByRole('button', { name: 'Installed', exact: true }).waitFor()
    await count(70)
    expect(await h.page.evaluate(() => window.scrollY)).toBe(y)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  })

  it('patches a connected App in place without refetching pages or moving the scroll position', async () => {
    await open()
    await h.page.getByTestId('marketplace-sentinel').scrollIntoViewIfNeeded()
    await count(48)
    const card = h.page.getByTestId('marketplace-card').filter({ has: h.page.getByRole('heading', { name: 'App 030', exact: true }) })
    await card.scrollIntoViewIfNeeded()
    const requests: string[] = [], y = await h.page.evaluate(() => window.scrollY)
    const listener = (request: { url(): string }) => { if (new URL(request.url()).pathname === '/api/marketplace/apps') requests.push(request.url()) }
    h.page.on('request', listener)
    try {
      vi.mocked(client.connections).mockResolvedValue([{ id: 'connected-app', toolkit: 'app-030', status: 'ACTIVE', createdAt: new Date().toISOString() }])
      await h.api.dependencies.composio.verifyConnection('app-030')
      h.api.dependencies.hub.broadcastAll({ type: 'connection.updated', app: 'App 030', status: 'connected', ts: new Date().toISOString() })
      await card.getByText('Connected', { exact: true }).waitFor()
      await count(48)
      expect(await h.page.evaluate(() => window.scrollY)).toBe(y)
      expect(requests).toEqual([])
    } finally { h.page.off('request', listener); vi.mocked(client.connections).mockResolvedValue([]); await h.api.dependencies.composio.listConnections(true) }
  })

  it('shows six loading skeletons and refetches a warming catalog after three seconds', async () => {
    let release!: () => void
    let ready = false
    const gate = new Promise<void>((resolve) => { release = resolve }), times: number[] = []
    await h.page.route('**/api/marketplace/apps?*', async (route) => {
      times.push(Date.now())
      const response = await route.fetch(), body = await response.json()
      await gate
      body.warming = !ready
      if (!ready) body.nextCursor = null
      await route.fulfill({ json: body })
    })
    try {
      await h.page.goto(`${h.url}/marketplace`, { waitUntil: 'domcontentloaded' })
      await vi.waitFor(async () => expect(await h.page.getByTestId('marketplace-skeleton').count()).toBe(6))
      release()
      await h.page.getByText('Loading the full catalog…', { exact: true }).waitFor()
      const initialRequests = times.length
      ready = true
      await vi.waitFor(async () => expect(await h.page.getByText('Loading the full catalog…', { exact: true }).count()).toBe(0), { timeout: 6000 })
      expect(times).toHaveLength(initialRequests + 1)
      expect(times.at(-1)! - times[initialRequests - 1]!).toBeGreaterThanOrEqual(2800)
      await count(24)
    } finally { release(); await h.page.unroute('**/api/marketplace/apps?*') }
  })
})
