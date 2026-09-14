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

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('uses CDP and re-adopts the turn tab after a connection loss', async () => {
  const f = await fixture()
  const pageServer = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<title>CDP browser test</title><h1>Persistent tab</h1>')
  })
  const cdpPortServer = createServer()
  const pagePort = await listening(pageServer)
  const cdpPort = await listening(cdpPortServer)
  await new Promise<void>((resolve) => cdpPortServer.close(() => resolve()))
  const profile = path.join(f.directory, 'cdp-profile')
  const desktopContext = await chromium.launchPersistentContext(profile, { headless: true, args: [`--remote-debugging-port=${cdpPort}`] })
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
  const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'browse over CDP' })
  const turn = posted.turns[0]!
  const session = browser.session(turn.id, new TurnEventRecorder(f.db, undefined, turn.id, f.roomId))
  const tools = browserTools(session)
  const context = { toolCallId: 'cdp-call', messages: [], context: { turnId: turn.id, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } }

  try {
    expect(await tools.browser_navigate.execute!({ url: `http://127.0.0.1:${pagePort}` }, context)).toContain('Persistent tab')
    expect(await tools.browser_snapshot.execute!({}, context)).toContain('Persistent tab')
    const screenshot = await tools.browser_screenshot.execute!({}, context) as { url: string }
    expect(await fs.readFile(path.join(f.directory, screenshot.url.replace('/api/', '')))).toBeTruthy()
    await (await session.getPage()).locator('h1').evaluate((heading) => { heading.textContent = 'Adopted tab' })

    const first = connections[0] as Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }
    await first._channel?.close({})
    await vi.waitFor(() => expect(first.isConnected()).toBe(false))
    expect(await tools.browser_snapshot.execute!({}, context)).toContain('Adopted tab')
    expect(connections).toHaveLength(2)
    expect((await f.db.select().from(turnEvents)).some((event) => event.type === 'screenshot')).toBe(true)
    const second = connections[1] as Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }
    await second._channel?.close({})
    await vi.waitFor(() => expect(second.isConnected()).toBe(false))
    await browser.finish(turn.id)
    expect(connections).toHaveLength(3)
    expect(desktopContext.pages().some((page) => page.url() === `http://127.0.0.1:${pagePort}/`)).toBe(false)
  } finally {
    await browser.close()
    await desktopContext.close()
    await new Promise<void>((resolve) => pageServer.close(() => resolve()))
    await f.close()
  }
}, 40_000)
