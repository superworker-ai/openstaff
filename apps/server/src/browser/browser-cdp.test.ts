import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium, type Browser } from 'playwright'
import { expect, it, vi } from 'vitest'
import { TurnEventRecorder } from '../agent/events.js'
import { turnEvents } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { BrowserService } from './service.js'
import { browserTools } from './tools.js'

async function listening(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function cdpFixture() {
  const f = await fixture()
  const pageServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    response.setHeader('content-type', 'text/html')
    response.end(`<title>CDP browser test</title><h1>${pathname}</h1>`)
  })
  const cdpPortServer = createServer()
  const pagePort = await listening(pageServer)
  const cdpPort = await listening(cdpPortServer)
  await new Promise<void>((resolve) => cdpPortServer.close(() => resolve()))
  const profile = path.join(f.directory, 'cdp-profile')
  const desktopContext = await chromium.launchPersistentContext(profile, { headless: true, args: [`--remote-debugging-port=${cdpPort}`] })
  const desktopPage = desktopContext.pages()[0] ?? await desktopContext.newPage()
  const cdpUrl = `http://127.0.0.1:${cdpPort}`
  await vi.waitFor(async () => expect((await fetch(`${cdpUrl}/json/version`)).ok).toBe(true), { timeout: 10_000 })

  const connections: Browser[] = []
  const connect = (async (url: string) => {
    const browser = await chromium.connectOverCDP(url)
    connections.push(browser)
    return browser
  }) as typeof chromium.connectOverCDP
  const browser = new BrowserService(f.directory, async () => ({
    kind: 'proxied',
    cdpUrl,
    streamUrl: 'http://desktop.invalid',
    viewer: { user: 'viewer', password: 'not-used' },
    controller: { user: 'controller', password: 'not-used' },
  }), chromium.launchPersistentContext.bind(chromium), connect)
  const url = (pathname: string) => `http://127.0.0.1:${pagePort}${pathname}`
  const turn = async (text: string) => {
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text })
    const value = posted.turns[0]!
    const session = browser.session(value.id, new TurnEventRecorder(f.db, undefined, value.id, f.roomId))
    const context = { toolCallId: `cdp-${value.id}`, messages: [], context: { turnId: value.id, roomId: f.roomId, botId: f.botId, actorUserId: null, handoffDepth: 0 } }
    return { value, session, tools: browserTools(session), context }
  }
  const close = async () => {
    await browser.close()
    await desktopContext.close()
    await new Promise<void>((resolve) => pageServer.close(() => resolve()))
    await f.close()
  }
  return { f, browser, desktopContext, desktopPage, connections, url, turn, close }
}

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('reuses the visible desktop tab and preserves it at finish', async () => {
  const h = await cdpFixture()
  try {
    await h.desktopPage.goto(h.url('/before'))
    await h.desktopPage.bringToFront()
    const count = h.desktopContext.pages().length
    const current = await h.turn('reuse the visible tab')

    expect(await current.tools.browser_navigate.execute!({ url: h.url('/reused') }, current.context)).toContain('/reused')
    expect(h.desktopContext.pages()).toHaveLength(count)
    expect(h.desktopPage.url()).toBe(h.url('/reused'))
    await h.browser.finish(current.value.id)
    expect(h.desktopPage.isClosed()).toBe(false)
    expect(h.desktopContext.pages()).toHaveLength(count)
  } finally { await h.close() }
}, 40_000)

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('keeps a loaded new tab and closes an unused created blank', async () => {
  const h = await cdpFixture()
  try {
    await h.desktopPage.goto(h.url('/kept'))
    await h.desktopPage.bringToFront()
    const count = h.desktopContext.pages().length
    const owner = await h.turn('own the visible tab')
    const adopted = await owner.session.getPage()
    const blankTurn = await h.turn('create an unused page')
    const blank = await blankTurn.session.getPage()

    expect(blank.url()).toBe('about:blank')
    expect(h.desktopContext.pages()).toHaveLength(count + 1)
    await h.browser.finish(blankTurn.value.id)
    expect(blank.isClosed()).toBe(true)
    expect(h.desktopContext.pages()).toHaveLength(count)

    expect(await owner.tools.browser_navigate.execute!({ url: h.url('/new-tab'), newTab: true }, owner.context)).toContain('/new-tab')
    const loaded = h.desktopContext.pages().find((page) => page.url() === h.url('/new-tab'))
    expect(adopted.url()).toBe(h.url('/kept'))
    expect(loaded).toBeTruthy()
    expect(h.desktopContext.pages()).toHaveLength(count + 1)
    await h.browser.finish(owner.value.id)
    expect(loaded?.isClosed()).toBe(false)
    expect(h.desktopContext.pages()).toHaveLength(count + 1)
  } finally { await h.close() }
}, 40_000)

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('does not let a second live session adopt the first session tab', async () => {
  const h = await cdpFixture()
  try {
    await h.desktopPage.bringToFront()
    const count = h.desktopContext.pages().length
    const first = await h.turn('first live turn')
    const second = await h.turn('second live turn')
    const firstPage = await first.session.getPage()
    const secondPage = await second.session.getPage()

    expect(secondPage).not.toBe(firstPage)
    expect(h.desktopContext.pages()).toHaveLength(count + 1)
    await h.browser.finish(second.value.id)
    expect(secondPage.isClosed()).toBe(true)
    await h.browser.finish(first.value.id)
    expect(h.desktopPage.isClosed()).toBe(false)
  } finally { await h.close() }
}, 40_000)

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('recovers a disconnected created blank only to close it', async () => {
  const h = await cdpFixture()
  try {
    const owner = await h.turn('own the existing tab')
    await owner.session.getPage()
    const blankTurn = await h.turn('open a blank tab')
    await blankTurn.session.getPage()
    expect(h.desktopContext.pages()).toHaveLength(2)

    const firstConnection = h.connections[0] as Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }
    await firstConnection._channel?.close({})
    await vi.waitFor(() => expect(firstConnection.isConnected()).toBe(false))
    await h.browser.finish(blankTurn.value.id)
    expect(h.connections).toHaveLength(2)
    await vi.waitFor(() => expect(h.desktopContext.pages()).toHaveLength(1))
    await h.browser.finish(owner.value.id)
  } finally { await h.close() }
}, 40_000)

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('uses CDP and re-adopts the turn tab after a connection loss', async () => {
  const h = await cdpFixture()
  const current = await h.turn('browse over CDP')
  try {
    expect(await current.tools.browser_navigate.execute!({ url: h.url('/persistent') }, current.context)).toContain('/persistent')
    expect(await current.tools.browser_snapshot.execute!({}, current.context)).toContain('/persistent')
    const screenshot = await current.tools.browser_screenshot.execute!({}, current.context) as { url: string }
    expect(await fs.readFile(path.join(h.f.directory, screenshot.url.replace('/api/', '')))).toBeTruthy()
    await (await current.session.getPage()).locator('h1').evaluate((heading) => { heading.textContent = 'Adopted tab' })

    const first = h.connections[0] as Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }
    await first._channel?.close({})
    await vi.waitFor(() => expect(first.isConnected()).toBe(false))
    expect(await current.tools.browser_snapshot.execute!({}, current.context)).toContain('Adopted tab')
    expect(h.connections).toHaveLength(2)
    expect((await h.f.db.select().from(turnEvents)).some((event) => event.type === 'screenshot')).toBe(true)
    const second = h.connections[1] as Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }
    await second._channel?.close({})
    await vi.waitFor(() => expect(second.isConnected()).toBe(false))
    await h.browser.finish(current.value.id)
    expect(h.connections).toHaveLength(2)
    expect(h.desktopContext.pages().some((page) => page.url() === h.url('/persistent'))).toBe(true)
  } finally { await h.close() }
}, 40_000)
