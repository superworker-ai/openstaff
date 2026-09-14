import path from 'node:path'
import type { DesktopInputAction } from '@openstaff/shared'
import type { Sandbox } from '@e2b/desktop'
import type { DesktopWindow } from './types.js'
import { E2B_CDP_NODE_PROXY, E2B_CDP_PYTHON_PROXY } from './e2b-cdp-proxy.js'

const CDP_PROXY_PORT = 9222
const CHROME_PORT = 9223
const READINESS_MS = 5000

function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\"'\"'") + "'" }

function windowId(value: string): string {
  try { return `0x${BigInt(value).toString(16)}` } catch { return value }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    await response.body?.cancel()
    return response.ok
  } catch { return false }
}

export class E2BDesktop {
  private streamStarted = false
  private authKey?: string
  private streamFlight?: Promise<void>
  private infrastructureFlight?: Promise<void>
  private infrastructureExpires = 0
  private readiness?: { expires: number; url: string; value: Promise<boolean> }
  private browserApplication?: string
  private resumeStream = true
  installedChromium = false

  constructor(private sandbox: Sandbox) {}

  attach(sandbox: Sandbox): void {
    this.sandbox = sandbox
    this.streamStarted = false
    this.authKey = undefined
    this.readiness = undefined
    this.infrastructureExpires = 0
  }

  get cdpUrl(): string { return `https://${this.sandbox.getHost(CDP_PROXY_PORT)}` }

  async initialize(): Promise<void> {
    await this.ensureInfrastructure()
    await this.ensureStream()
  }

  private async background(command: string, envs: Record<string, string>): Promise<void> {
    const handle = await this.sandbox.commands.run(command, { background: true, timeoutMs: 0, envs })
    await handle.disconnect()
  }

  private async localReady(port: number): Promise<boolean> {
    try {
      const result = await this.sandbox.commands.run(`curl -fsS --max-time 2 http://127.0.0.1:${port}/json/version >/dev/null`)
      return result.exitCode === 0
    } catch { return false }
  }

  private async waitUntilLocalReady(port: number): Promise<boolean> {
    return this.sandbox.waitAndVerify(
      `curl -fsS --max-time 2 http://127.0.0.1:${port}/json/version >/dev/null`,
      (result) => result.exitCode === 0,
      20,
      0.5,
    )
  }

  private async browserExecutable(): Promise<string> {
    const found = await this.sandbox.commands.run("browser=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true); printf '%s' \"$browser\"")
    let executable = found.stdout.trim()
    if (!executable) {
      await this.sandbox.commands.run('sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium', { timeoutMs: 10 * 60_000 })
      executable = (await this.sandbox.commands.run("command -v chromium || command -v chromium-browser")).stdout.trim()
      this.installedChromium = true
    }
    if (!executable.startsWith('/')) throw new Error('E2B desktop Chromium is unavailable')
    this.browserApplication = path.basename(executable)
    return executable
  }

  private ensureInfrastructure(): Promise<void> {
    if (Date.now() < this.infrastructureExpires) return Promise.resolve()
    if (!this.infrastructureFlight) {
      const flight = this.ensureBrowserAndProxy().then(() => { this.infrastructureExpires = Date.now() + READINESS_MS })
      const tracked = flight.finally(() => {
        if (this.infrastructureFlight === tracked) this.infrastructureFlight = undefined
      })
      this.infrastructureFlight = tracked
    }
    return this.infrastructureFlight
  }

  private async ensureBrowserAndProxy(): Promise<void> {
    if (!await this.localReady(CHROME_PORT)) {
      const executable = await this.browserExecutable()
      await this.sandbox.commands.run('mkdir -p /home/user/.config/openstaff/chrome')
      await this.background([
        shellQuote(executable),
        `--remote-debugging-port=${CHROME_PORT}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        '--user-data-dir=/home/user/.config/openstaff/chrome',
        '--password-store=basic',
        '--no-first-run',
        'about:blank',
      ].join(' '), { DISPLAY: this.sandbox.display || ':0' })
      if (!await this.waitUntilLocalReady(CHROME_PORT)) throw new Error('E2B desktop Chromium CDP did not become ready')
    }

    if (!await this.localReady(CDP_PROXY_PORT)) {
      await Promise.all([
        this.sandbox.files.write('/tmp/openstaff-cdp-proxy.mjs', E2B_CDP_NODE_PROXY),
        this.sandbox.files.write('/tmp/openstaff-cdp-proxy.py', E2B_CDP_PYTHON_PROXY),
      ])
      const runtime = (await this.sandbox.commands.run("runtime=$(command -v node || command -v python3 || true); printf '%s' \"$runtime\"")).stdout.trim()
      if (!runtime) throw new Error('E2B desktop has no Node.js or Python runtime for the CDP proxy')
      await this.sandbox.commands.run("pkill -f '/tmp/[o]penstaff-cdp-proxy' || true")
      const command = path.basename(runtime).startsWith('node') ? `${shellQuote(runtime)} /tmp/openstaff-cdp-proxy.mjs` : `${shellQuote(runtime)} /tmp/openstaff-cdp-proxy.py`
      await this.background(command, { LISTEN_PORT: String(CDP_PROXY_PORT), TARGET_PORT: String(CHROME_PORT), PUBLIC_HOST: this.sandbox.getHost(CDP_PROXY_PORT) })
      if (!await this.waitUntilLocalReady(CDP_PROXY_PORT)) throw new Error('E2B desktop CDP proxy did not become ready')
    }
    this.readiness = undefined
  }

  private async streamRunning(): Promise<boolean> {
    try {
      const result = await this.sandbox.commands.run('pgrep -x x11vnc >/dev/null && (command -v ss >/dev/null && ss -ltn | grep -q ":6080 " || netstat -ltn | grep -q ":6080 ")')
      return result.exitCode === 0
    } catch { return false }
  }

  private ensureStream(forceRotate = false): Promise<void> {
    if (!this.streamFlight) {
      const flight = (async () => {
        if (!forceRotate && this.streamStarted && this.authKey && await this.streamRunning()) return
        await this.sandbox.stream.stop().catch(() => undefined)
        await this.sandbox.commands.run("pkill -f '[n]ovnc_proxy.*--listen 6080' || true")
        this.streamStarted = false
        this.authKey = undefined
        await this.sandbox.stream.start({ requireAuth: true })
        this.authKey = await this.sandbox.stream.getAuthKey()
        this.streamStarted = true
      })()
      const tracked = flight.finally(() => { if (this.streamFlight === tracked) this.streamFlight = undefined })
      this.streamFlight = tracked
    }
    return this.streamFlight
  }

  private async url(viewOnly: boolean): Promise<string> {
    await this.ensureStream()
    return this.sandbox.stream.getUrl({ viewOnly, authKey: this.authKey })
  }

  async viewerUrl(): Promise<string> { return this.url(true) }
  async controllerUrl(): Promise<string> { return this.url(false) }

  async revoke(): Promise<void> { await this.ensureStream(true) }

  async beforePause(): Promise<void> {
    await this.sandbox.screenshot()
    this.resumeStream = await this.streamRunning()
  }

  async afterResume(sandbox: Sandbox): Promise<void> {
    this.sandbox = sandbox
    this.readiness = undefined
    this.infrastructureExpires = 0
    await this.ensureInfrastructure()
    if (this.resumeStream) await this.ensureStream()
  }

  async status(): Promise<{ stream: boolean; cdp: boolean }> {
    const url = this.cdpUrl
    if (!this.readiness || this.readiness.url !== url || Date.now() >= this.readiness.expires) {
      const value = reachable(new URL('/json/version', url).toString())
      const cache = { expires: Date.now() + READINESS_MS, url, value }
      this.readiness = cache
      void value.catch(() => { if (this.readiness === cache) this.readiness = undefined })
    }
    return { stream: this.streamStarted && await this.streamRunning(), cdp: await this.readiness.value }
  }

  async captureScreen(): Promise<{ image: Uint8Array; mediaType: 'image/png'; width: number; height: number }> {
    const [image, size] = await Promise.all([this.sandbox.screenshot(), this.sandbox.getScreenSize()])
    return { image, mediaType: 'image/png', ...size }
  }

  async input(action: DesktopInputAction): Promise<void> {
    switch (action.type) {
      case 'click':
        if (action.button === 2) await this.sandbox.middleClick(action.x, action.y)
        else if (action.button === 3) await this.sandbox.rightClick(action.x, action.y)
        else await this.sandbox.leftClick(action.x, action.y)
        break
      case 'double_click': await this.sandbox.doubleClick(action.x, action.y); break
      case 'right_click': await this.sandbox.rightClick(action.x, action.y); break
      case 'move': await this.sandbox.moveMouse(action.x, action.y); break
      case 'drag': await this.sandbox.drag([action.fromX, action.fromY], [action.toX, action.toY]); break
      case 'scroll': await this.sandbox.moveMouse(action.x, action.y); await this.sandbox.scroll(action.direction, action.amount); break
      case 'type': await this.sandbox.write(action.text); break
      case 'key': await this.sandbox.press(action.key.includes('+') ? action.key.split('+') : action.key); break
    }
  }

  async cursor(): Promise<{ x: number; y: number }> { return this.sandbox.getCursorPosition() }

  async windows(): Promise<DesktopWindow[]> {
    const [ids, active] = await Promise.all([
      this.sandbox.getApplicationWindows('.\\*').catch(() => []),
      this.sandbox.getCurrentWindowId().catch(() => ''),
    ])
    return Promise.all(ids.filter(Boolean).map(async (id) => ({ id: windowId(id), title: await this.sandbox.getWindowTitle(id), active: windowId(id) === windowId(active) })))
  }

  async focus(input: { id?: string; titleContains?: string }): Promise<void> {
    const windows = await this.windows()
    const match = input.id
      ? windows.find((item) => item.id.toLowerCase() === input.id!.toLowerCase())
      : windows.find((item) => item.title.toLowerCase().includes(input.titleContains!.toLowerCase()))
    if (!match && input.titleContains && /chrom(e|ium)/i.test(input.titleContains) && this.browserApplication) {
      await this.sandbox.launch(this.browserApplication)
      return
    }
    if (!match) throw new Error(input.id ? `No desktop window ${input.id}` : `No window title contains ${input.titleContains}`)
    await this.sandbox.commands.run(`xdotool windowactivate --sync ${BigInt(match.id).toString()}`)
  }
}
