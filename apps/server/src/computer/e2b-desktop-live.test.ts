import '../load-env.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Sandbox, Volume } from 'e2b'
import { computerInstances } from '../db/schema.js'
import { Secrets } from '../secrets.js'
import { fixture } from '../test/fixture.js'
import { ComputerManager } from './manager.js'
import { e2bProvider } from './e2b.js'
import { e2bInstanceGone } from './e2b-errors.js'
import { computerProvider, registerComputerProvider } from './registry.js'
import type { ComputerProvider } from './provider.js'

type DisconnectableBrowser = Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }

describe.skipIf(process.env.E2B_TESTS !== '1')('E2B desktop live contract', () => {
  const apiKey = process.env.E2B_API_KEY ?? ''
  let f: Awaited<ReturnType<typeof fixture>>
  let manager: ComputerManager
  let original: ComputerProvider

  beforeAll(async () => {
    if (!apiKey) throw new Error('E2B_TESTS requires E2B_API_KEY')
    vi.stubEnv('COMPUTER_DRIVER', 'e2b')
    vi.stubEnv('E2B_DESKTOP', '1')
    original = computerProvider('e2b')
    registerComputerProvider(e2bProvider)
    f = await fixture()
    manager = new ComputerManager(path.join(f.directory, 'e2b-workspace'), f.db, new Secrets(Buffer.alloc(32, 7)))
    await manager.initialize()
  }, 240_000)

  afterAll(async () => {
    try {
      const record = f ? (await f.db.select().from(computerInstances).where(eq(computerInstances.provider, 'e2b')).limit(1))[0] : undefined
      await manager?.destroy().catch(() => undefined)
      if (record) {
        await Sandbox.kill(record.externalId, { apiKey }).catch(() => undefined)
        let sandboxGone = false
        try { await Sandbox.getInfo(record.externalId, { apiKey }) }
        catch (error) { if (e2bInstanceGone(error)) sandboxGone = true; else throw error }
        expect(sandboxGone).toBe(true)
        const volumeId = typeof record.metadata.e2bVolumeId === 'string' ? record.metadata.e2bVolumeId : undefined
        if (volumeId) {
          await Volume.destroy(volumeId, { apiKey }).catch(() => undefined)
          expect((await Volume.list({ apiKey })).some((volume) => volume.volumeId === volumeId)).toBe(false)
        }
        console.log('E2B desktop live cleanup confirmed: sandbox and test volume absent')
      }
    } finally {
      await manager?.close().catch(() => undefined)
      await f?.close()
      if (original) registerComputerProvider(original)
      vi.unstubAllEnvs()
    }
  }, 180_000)

  it('preserves a visible browser cookie and restores stream plus CDP after manager pause and resume', async () => {
    await manager.exec("mkdir -p /workspace/phase-d-page && printf '<title>Phase D</title><h1 style=\"color:#0a7\">E2B desktop persistence</h1>' > /workspace/phase-d-page/index.html && (python3 -m http.server 8765 --directory /workspace/phase-d-page >/tmp/phase-d-http.log 2>&1 &)")
    const before = await manager.captureScreen()
    expect(before).toMatchObject({ mediaType: 'image/png', width: 1280, height: 800 })
    expect(Buffer.from(before.image).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await manager.desktopInput({ type: 'key', key: 'ctrl+l' })
    await manager.desktopInput({ type: 'type', text: 'http://127.0.0.1:8765' })
    await manager.desktopInput({ type: 'key', key: 'enter' })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const after = await manager.captureScreen()
    expect(Buffer.from(after.image).equals(Buffer.from(before.image))).toBe(false)

    const directory = path.resolve('.context/screenshots')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'desktop-phaseD-before.png'), before.image)
    await fs.writeFile(path.join(directory, 'desktop-phaseD-after.png'), after.image)

    const firstDesktop = await manager.desktop()
    expect(firstDesktop?.kind).toBe('external')
    const firstBrowser = await chromium.connectOverCDP(firstDesktop!.cdpUrl)
    expect(firstBrowser.contexts()[0]?.pages().length).toBeGreaterThan(0)
    const page = firstBrowser.contexts()[0]!.pages().find((item) => item.url().startsWith('http://127.0.0.1:8765')) ?? firstBrowser.contexts()[0]!.pages()[0]!
    await page.goto('http://127.0.0.1:8765')
    await page.evaluate(() => { document.cookie = 'phaseD=persisted; path=/' })
    await (firstBrowser as DisconnectableBrowser)._channel?.close({})

    await manager.stop()
    expect((await manager.status()).status).toBe('paused')
    await manager.captureScreen()

    const resumedDesktop = await manager.desktop()
    expect(resumedDesktop?.kind).toBe('external')
    if (resumedDesktop?.kind !== 'external') throw new Error('Expected external E2B desktop')
    const viewer = await fetch(await resumedDesktop.viewerUrl())
    expect(viewer.status).toBe(200)
    await viewer.body?.cancel()

    const resumedBrowser = await chromium.connectOverCDP(resumedDesktop.cdpUrl)
    expect(resumedBrowser.contexts()[0]?.pages().length).toBeGreaterThan(0)
    expect(await resumedBrowser.contexts()[0]!.cookies('http://127.0.0.1:8765')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'phaseD', value: 'persisted' })]))
    await (resumedBrowser as DisconnectableBrowser)._channel?.close({})
    console.log('E2B desktop live proof passed: screenshot, input, CDP, pause/resume, cookie, and viewer stream')
  }, 300_000)
})
