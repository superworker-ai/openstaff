import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { TurnEventRecorder } from '../agent/events.js'
import { numericHttpEndpoint } from '../computer/desktop-network.js'
import type { DesktopEndpoints } from '../computer/types.js'
import type { ComputerLeaseGate } from '../computer/lease.js'
import { DisplayGate } from '../computer/display-gate.js'
import { ScreenRecorder } from '../computer/screen-recorder.js'

type PersistentLaunch = typeof chromium.launchPersistentContext
type CdpConnect = typeof chromium.connectOverCDP
type BrowserConnection = Browser & { _channel?: { close(options: Record<string, never>): Promise<unknown> } }

interface CdpContext {
  browser: Browser
  context: BrowserContext
}

interface SessionPage {
  page: Page
  mode: 'local' | 'cdp'
  created: boolean
  reAdopted?: boolean
}

export interface BrowserServiceOptions { lease?: ComputerLeaseGate; displayGate?: DisplayGate }

const noDesktop = async (): Promise<DesktopEndpoints | null> => null
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
// A desktop tab whose renderer is frozen, discarded, or busy never answers CDP page commands.
// Probes must give up quickly or one dead tab blocks every turn behind the display gate.
const PROBE_MS = 1500
const CLOSE_WAIT_MS = 5000
function bounded<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, () => { clearTimeout(timer); resolve(fallback) })
  })
}

export class BrowserService {
  private localContext?: Promise<BrowserContext>
  private cdp?: { url: string; value: Promise<CdpContext> }
  private cdpBrowser?: Browser
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly targets = new Map<string, string>()
  readonly displayGate: DisplayGate

  constructor(
    readonly dataDir: string,
    private readonly desktop: () => Promise<DesktopEndpoints | null> = noDesktop,
    private readonly launch: PersistentLaunch = chromium.launchPersistentContext.bind(chromium),
    private readonly connect: CdpConnect = chromium.connectOverCDP.bind(chromium),
    private readonly options: BrowserServiceOptions = {},
  ) { this.displayGate = options.displayGate ?? new DisplayGate(options.lease) }

  private async getLocalContext(): Promise<BrowserContext> {
    if (!this.localContext) {
      this.localContext = (async () => {
        await fs.mkdir(path.join(this.dataDir, 'browser-artifacts'), { recursive: true })
        const context = await this.launch(path.join(this.dataDir, 'browser-profile'), { headless: true, acceptDownloads: false, artifactsDir: path.join(this.dataDir, 'browser-artifacts'), viewport: { width: 1280, height: 800 } })
        context.setDefaultTimeout(15_000)
        context.on('close', () => { this.localContext = undefined })
        return context
      })().catch((error) => {
        this.localContext = undefined
        throw new Error(`Browser unavailable. Install Chromium with the server's playwright install chromium command. ${error instanceof Error ? error.message.split('\n')[0] : error}`)
      })
    }
    return this.localContext
  }

  private async connectDesktop(url: string): Promise<CdpContext> {
    const started = Date.now()
    let backoff = 250
    let lastError: unknown
    while (Date.now() - started < 60_000) {
      try {
        const browser = await this.connect(await numericHttpEndpoint(url), { timeout: Math.min(5000, Math.max(1, 60_000 - (Date.now() - started))) })
        const context = browser.contexts()[0]
        if (!context) throw new Error('Desktop browser has no default context')
        context.setDefaultTimeout(15_000)
        this.cdpBrowser = browser
        browser.on('disconnected', () => {
          if (this.cdpBrowser !== browser) return
          this.cdpBrowser = undefined
          this.cdp = undefined
          for (const session of this.sessions.values()) session.disconnected()
        })
        return { browser, context }
      } catch (error) {
        lastError = error
        const remaining = 60_000 - (Date.now() - started)
        if (remaining <= 0) break
        await delay(Math.min(backoff, remaining))
        backoff = Math.min(backoff * 2, 5000)
      }
    }
    throw new Error(`Browser unavailable. The desktop Chromium CDP endpoint did not become ready. ${lastError instanceof Error ? lastError.message.split('\n')[0] : ''}`.trim())
  }

  private getCdpContext(url: string): Promise<CdpContext> {
    if (!this.cdp || this.cdp.url !== url) {
      const value = this.connectDesktop(url)
      const cdp = { url, value }
      this.cdp = cdp
      void value.catch(() => { if (this.cdp === cdp) this.cdp = undefined })
    }
    return this.cdp.value
  }

  private async targetId(context: BrowserContext, page: Page): Promise<string | null> {
    const session = await context.newCDPSession(page)
    try {
      const response = await session.send('Target.getTargetInfo') as { targetInfo?: { targetId?: string } }
      return response.targetInfo?.targetId ?? null
    } finally { await session.detach().catch(() => undefined) }
  }

  private probeTargetId(context: BrowserContext, page: Page): Promise<string | null> {
    return bounded(this.targetId(context, page), PROBE_MS, null)
  }

  private async register(turnId: string, context: BrowserContext, page: Page): Promise<void> {
    const target = await this.probeTargetId(context, page)
    if (target) this.targets.set(turnId, target)
    else this.targets.delete(turnId)
  }

  private async registeredPage(turnId: string, context: BrowserContext): Promise<Page | undefined> {
    const existingTarget = this.targets.get(turnId)
    if (!existingTarget) return
    for (const page of context.pages()) {
      if (!page.isClosed() && await this.probeTargetId(context, page) === existingTarget) return page
    }
  }

  /** 'visible' | 'hidden' for a responsive tab; undefined when the tab never answers. */
  private probeVisibility(page: Page): Promise<'visible' | 'hidden' | undefined> {
    return bounded(page.evaluate(() => document.visibilityState === 'visible' ? 'visible' as const : 'hidden' as const), PROBE_MS, undefined)
  }

  private async pageForTurn(turnId: string, newTab = false): Promise<SessionPage> {
    const desktop = await this.desktop()
    if (!desktop) return { page: await (await this.getLocalContext()).newPage(), mode: 'local', created: true }
    const { context } = await this.getCdpContext(desktop.cdpUrl)
    if (!newTab) {
      const registered = await this.registeredPage(turnId, context)
      if (registered) return { page: registered, mode: 'cdp', created: false, reAdopted: true }

      const ownedTargets = new Set([...this.targets]
        .filter(([sessionId]) => sessionId !== turnId && this.sessions.has(sessionId))
        .map(([, target]) => target))
      let fallback: Page | undefined
      for (const page of context.pages()) {
        if (page.isClosed()) continue
        const target = await this.probeTargetId(context, page)
        if (!target || ownedTargets.has(target)) continue
        const visibility = await this.probeVisibility(page)
        if (!visibility) continue
        fallback = page
        if (visibility === 'visible') {
          this.targets.set(turnId, target)
          return { page, mode: 'cdp', created: false }
        }
      }
      if (fallback) {
        await this.register(turnId, context, fallback)
        return { page: fallback, mode: 'cdp', created: false }
      }
    }
    const page = await context.newPage()
    await this.register(turnId, context, page)
    return { page, mode: 'cdp', created: true }
  }

  private async recoverRegisteredPage(turnId: string): Promise<Page | undefined> {
    const desktop = await this.desktop()
    if (!desktop) return
    const { context } = await this.getCdpContext(desktop.cdpUrl)
    return this.registeredPage(turnId, context)
  }

  session(turnId: string, recorder: TurnEventRecorder, signal?: AbortSignal): BrowserSession {
    let session = this.sessions.get(turnId)
    if (!session) {
      session = new BrowserSession(turnId, (newTab) => this.pageForTurn(turnId, newTab), () => this.recoverRegisteredPage(turnId), this.displayGate, new ScreenRecorder(this.dataDir, turnId, recorder), recorder, signal)
      this.sessions.set(turnId, session)
    } else session.bind(recorder, signal)
    return session
  }

  async finish(turnId: string): Promise<void> {
    const session = this.sessions.get(turnId)
    try { await session?.close() } finally {
      this.sessions.delete(turnId)
      this.targets.delete(turnId)
    }
  }

  private async disconnect(browser: Browser): Promise<void> {
    // Playwright 1.63 has no public disconnect method. Closing the private CDP channel
    // invokes the CDP transport's close callback without sending Browser.close to Chromium.
    await (browser as BrowserConnection)._channel?.close({})
  }

  async close(): Promise<void> {
    const cdp = this.cdp
    this.cdp = undefined
    this.cdpBrowser = undefined
    if (cdp) {
      for (const session of this.sessions.values()) session.dispose()
      this.sessions.clear()
      this.targets.clear()
      const connected = await cdp.value.catch(() => undefined)
      if (connected) await this.disconnect(connected.browser)
      return
    }
    await Promise.all([...this.sessions.keys()].map((id) => this.finish(id)))
    const context = this.localContext
    this.localContext = undefined
    if (context) await (await context.catch(() => undefined))?.close()
  }
}

export class BrowserSession {
  private page?: Promise<Page>
  private currentPage?: Page
  private mode?: SessionPage['mode']
  private created = false
  private lastUrl?: string
  private tail: Promise<unknown> = Promise.resolve()
  private lastShot = 0
  private closed = false
  private readonly abort = () => { void this.close() }

  constructor(
    private readonly turnId: string,
    private readonly newPage: (newTab?: boolean) => Promise<SessionPage>,
    private readonly recoverPage: () => Promise<Page | undefined>,
    readonly displayGate: DisplayGate,
    readonly screenRecorder: ScreenRecorder,
    private recorder: TurnEventRecorder,
    private signal?: AbortSignal,
  ) { signal?.addEventListener('abort', this.abort, { once: true }) }

  bind(recorder: TurnEventRecorder, signal?: AbortSignal) {
    this.signal?.removeEventListener('abort', this.abort)
    this.recorder = recorder
    this.screenRecorder.bind(recorder)
    this.signal = signal
    signal?.addEventListener('abort', this.abort, { once: true })
  }

  run<T>(operation: () => Promise<T>, newTab = false): Promise<T> {
    const result = this.tail.then(async () => {
      const gated = await this.displayGate.run(this.recorder, this.signal, async ({ resumed }) => {
        const page = await this.getPage(newTab)
        await page.bringToFront()
        if (resumed) await this.screenshot(true, true)
        return operation()
      })
      return typeof gated.value === 'string' && gated.controlChanged
        ? `${gated.value}\n[control changed during this action; take a fresh browser_snapshot before acting]` as T
        : gated.value
    })
    this.tail = result.catch(() => undefined)
    return result
  }

  async getPage(newTab = false): Promise<Page> {
    if (this.closed || this.signal?.aborted) throw new Error('Browser turn was stopped')
    if (this.page) {
      const page = await this.page.catch(() => undefined)
      if (page && !page.isClosed() && (!newTab || this.mode === 'local')) return page
      this.page = undefined
      this.currentPage = undefined
    }
    const page = this.newPage(newTab && this.mode !== 'local').then((selection) => {
      if (this.page === page) {
        this.currentPage = selection.page
        this.mode = selection.mode
        if (!selection.reAdopted) this.created = selection.created
        this.lastUrl = selection.page.url()
      }
      return selection.page
    })
    this.page = page
    void page.catch(() => { if (this.page === page) this.page = undefined })
    return page
  }

  disconnected() {
    if (this.currentPage) this.lastUrl = this.currentPage.url()
    this.page = undefined
    this.currentPage = undefined
  }

  /** Page identity for decision state. Added for the bounded-action experiment; no behaviour change to existing calls. */
  async location(): Promise<{ url: string; title: string }> {
    const page = await this.getPage()
    return { url: page.url(), title: await page.title() }
  }

  async snapshot(): Promise<string> {
    return Buffer.from(await (await this.getPage()).ariaSnapshot({ mode: 'ai' })).subarray(0, 12 * 1024).toString()
  }

  async screenshot(automatic = false, bypassThrottle = false) {
    if (automatic && !bypassThrottle && Date.now() - this.lastShot < 2000) return null
    this.lastShot = Date.now()
    const page = await this.getPage()
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 })
    return this.screenRecorder.saveJpeg(jpeg, { pageUrl: page.url(), title: await page.title() })
  }

  dispose() {
    this.closed = true
    this.signal?.removeEventListener('abort', this.abort)
    this.page = undefined
    this.currentPage = undefined
  }

  async close() {
    this.signal?.removeEventListener('abort', this.abort)
    const page = this.page
      ? await bounded(this.page, CLOSE_WAIT_MS, undefined)
      : this.currentPage
    const mode = this.mode
    const created = this.created
    const lastUrl = page?.url() ?? this.lastUrl
    this.closed = true
    if (mode === 'local') await page?.close().catch(() => undefined)
    if (mode === 'cdp' && created && lastUrl === 'about:blank') {
      const blank = page && !page.isClosed() ? page : await this.recoverPage().catch(() => undefined)
      if (blank?.url() === 'about:blank') await blank.close().catch(() => undefined)
    }
    this.page = undefined
    this.currentPage = undefined
  }
}
