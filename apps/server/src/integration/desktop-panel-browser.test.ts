import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { browserHarness } from '../test/browser-harness.js'
import { users } from '../db/schema.js'

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('takes and returns control through the live desktop panel', async () => {
  const h = await browserHarness()
  let userId = ''
  let epoch = 0
  let lease = { ownerKind: 'bot', ownerId: null as string | null, ownerName: null as string | null, epoch, acquiredAt: new Date().toISOString(), expiresAt: null as string | null, reason: null as string | null }
  try {
    await h.page.route('**/api/computer/status', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'docker', status: 'ready', lockedByEnv: false, desktop: { kind: 'proxied', stream: true, cdp: true }, lease }) }))
    await h.page.route('**/api/computer/lease/take', (route) => {
      epoch += 1
      lease = { ownerKind: 'human', ownerId: userId, ownerName: 'Desktop Owner', epoch, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), reason: null }
      return route.fulfill({ json: lease })
    })
    await h.page.route('**/api/computer/lease/release', (route) => {
      epoch += 1
      lease = { ownerKind: 'bot', ownerId: null, ownerName: null, epoch, acquiredAt: new Date().toISOString(), expiresAt: null, reason: null }
      return route.fulfill({ json: lease })
    })
    await h.page.route('**/api/computer/desktop/**', (route) => route.fulfill({ contentType: 'text/html', body: '<style>body{background:#111;color:white;font:24px sans-serif;display:grid;place-items:center;height:100vh}</style><p>Live desktop</p>' }))
    await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await h.page.getByRole('link', { name: 'Create account', exact: true }).click()
    await h.page.getByPlaceholder('Your name').fill('Desktop Owner')
    await h.page.getByPlaceholder('Email', { exact: true }).fill('desktop-panel@example.test')
    await h.page.getByPlaceholder('Password', { exact: true }).fill('browser-password123')
    await h.page.getByRole('button', { name: 'Create account', exact: true }).click()
    await h.page.getByRole('button', { name: /Engineer/ }).click()
    await h.page.getByPlaceholder('e.g. Drake').fill('Desktop Bot')
    await h.page.getByRole('button', { name: 'Create teammate' }).click()
    await h.page.getByPlaceholder('Message Desktop Bot', { exact: true }).fill('Show activity')
    await h.page.getByPlaceholder('Message Desktop Bot', { exact: true }).press('Enter')
    await h.page.getByTestId('thread').getByText('Hello from your teammate.', { exact: true }).waitFor()
    userId = (await h.api.dependencies.db.select({ id: users.id }).from(users))[0]!.id
    if (await h.page.getByRole('button', { name: 'Computer', exact: true }).getAttribute('aria-pressed') !== 'true') await h.page.getByRole('button', { name: 'Computer', exact: true }).click()
    const frame = h.page.getByTitle('Live Computer desktop')
    await expect.poll(() => frame.getAttribute('src')).toBe('/api/computer/desktop/?autoconnect=1&reconnect=1&view_only=1&resize=scale&show_control_bar=0&path=api%2Fcomputer%2Fdesktop%2Fwebsockify')
    await expect.poll(() => h.page.getByText('Live · Bot in control', { exact: true }).count()).toBe(1)
    const activity = h.page.getByRole('button', { name: 'Activity', exact: true })
    await expect.poll(() => activity.isVisible()).toBe(true)
    await activity.click()
    const drawer = h.page.getByRole('region', { name: 'Activity', exact: true })
    await expect.poll(() => drawer.isVisible()).toBe(true)
    await expect.poll(() => drawer.getByText('Working', { exact: true }).isVisible()).toBe(true)
    await h.page.keyboard.press('Escape')
    await expect.poll(() => drawer.isHidden()).toBe(true)
    await h.page.getByRole('button', { name: 'Take over', exact: true }).click()
    await expect.poll(() => frame.getAttribute('src')).toContain('mode=control')
    await expect.poll(() => h.page.getByText(/You have control · returns in/).count()).toBe(1)
    const directory = path.resolve('.context/screenshots')
    await fs.mkdir(directory, { recursive: true })
    await h.page.screenshot({ path: path.join(directory, 'desktop-phaseB-takeover.png'), fullPage: true })
    await h.page.getByRole('button', { name: 'Return control', exact: true }).click()
    await expect.poll(() => frame.getAttribute('src')).not.toContain('mode=control')
  } finally { await h.stop() }
}, 45_000)

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('loads an external desktop session and refreshes it after takeover', async () => {
  const h = await browserHarness()
  let userId = ''
  let epoch = 0
  let lease = { ownerKind: 'bot', ownerId: null as string | null, ownerName: null as string | null, epoch, acquiredAt: new Date().toISOString(), expiresAt: null as string | null, reason: null as string | null }
  const sessions: string[] = []
  try {
    await h.page.route('**/api/computer/status', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'e2b', status: 'ready', lockedByEnv: false, desktop: { kind: 'external', stream: true, cdp: true, template: 'desktop' }, lease }) }))
    await h.page.route('**/api/computer/desktop/session?*', (route) => {
      const mode = new URL(route.request().url()).searchParams.get('mode') ?? 'viewer'
      sessions.push(mode)
      return route.fulfill({ json: { kind: mode, url: `https://desktop.example.test/${mode}?token=session-${epoch}` }, headers: { 'cache-control': 'no-store' } })
    })
    await h.page.route('https://desktop.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>External desktop</p>' }))
    await h.page.route('**/api/computer/lease/take', (route) => {
      epoch += 1
      lease = { ownerKind: 'human', ownerId: userId, ownerName: 'Desktop Owner', epoch, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), reason: null }
      return route.fulfill({ json: lease })
    })
    await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await h.page.getByRole('link', { name: 'Create account', exact: true }).click()
    await h.page.getByPlaceholder('Your name').fill('Desktop Owner')
    await h.page.getByPlaceholder('Email', { exact: true }).fill('desktop-external@example.test')
    await h.page.getByPlaceholder('Password', { exact: true }).fill('browser-password123')
    await h.page.getByRole('button', { name: 'Create account', exact: true }).click()
    await h.page.getByRole('button', { name: /Engineer/ }).click()
    await h.page.getByPlaceholder('e.g. Drake').fill('Desktop Bot')
    await h.page.getByRole('button', { name: 'Create teammate' }).click()
    userId = (await h.api.dependencies.db.select({ id: users.id }).from(users))[0]!.id
    if (await h.page.getByRole('button', { name: 'Computer', exact: true }).getAttribute('aria-pressed') !== 'true') await h.page.getByRole('button', { name: 'Computer', exact: true }).click()
    const frame = h.page.getByTitle('Live Computer desktop')
    await expect.poll(() => frame.getAttribute('src')).toBe('https://desktop.example.test/viewer?token=session-0')
    await expect.poll(() => frame.getAttribute('sandbox')).toBeNull()
    await h.page.getByRole('button', { name: 'Take over', exact: true }).click()
    await expect.poll(() => frame.getAttribute('src')).toBe('https://desktop.example.test/control?token=session-1')
    expect(sessions).toContain('viewer')
    expect(sessions).toContain('control')
  } finally { await h.stop() }
}, 45_000)
