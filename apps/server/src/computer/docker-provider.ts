import type { ComputerCapabilities, DesktopInputAction } from '@openstaff/shared'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { DockerComputer, dockerClient } from './docker.js'
import { desktopPasswords } from './desktop-secrets.js'
import { numericHttpEndpoint } from './desktop-network.js'
import { dockerDiagnostic } from './docker-errors.js'
import type { ComputerProvider } from './provider.js'
import type { ManagedComputer } from './types.js'
import { computerEnvironment } from './environment.js'
import { execBinary, execDocker } from './docker-exec.js'
import { desktopInputArguments } from './desktop-input.js'

const capabilities: ComputerCapabilities = { persistent: true, snapshots: false, explicitStop: true, hostFiles: true, desktop: true, volume: false }

async function reachable(url: string, authorization?: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: authorization ? { authorization } : undefined, signal: AbortSignal.timeout(2000) })
    await response.body?.cancel()
    return response.ok
  } catch { return false }
}

function diagnosticEndpoint(value: string): string {
  const endpoint = new URL(value)
  return `${endpoint.origin}${endpoint.pathname === '/' ? '' : endpoint.pathname}`
}

export class ManagedDockerComputer extends DockerComputer implements ManagedComputer {
  private desktopStatus?: { key: string; expires: number; value: Promise<{ stream: boolean; cdp: boolean }> }
  private screenSize?: Promise<{ width: number; height: number }>
  async desktop() { return this.desktopEndpoints() }
  async captureScreen(options: { quality?: number } = {}) {
    const quality = options.quality ?? 60
    if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) throw new Error('Screenshot quality must be an integer from 1 to 100')
    const container = await this.ensure()
    const environment = computerEnvironment('/workspace', true, '/home/worker')
    const file = `/tmp/sw-screen-${randomUUID()}.jpg`
    try {
      await execBinary(container, ['/usr/local/bin/sw-screenshot', file, String(quality)], '/workspace', environment, 15_000)
      const image = await execBinary(container, ['/bin/cat', file], '/workspace', environment, 15_000)
      const { width, height } = await this.getScreenSize(container)
      return { image: new Uint8Array(image), mediaType: 'image/jpeg' as const, width, height }
    } finally {
      await execBinary(container, ['/bin/rm', '-f', file], '/workspace', environment, 5000).catch(() => undefined)
    }
  }
  async desktopInput(action: DesktopInputAction): Promise<void> {
    await execBinary(await this.ensure(), ['/usr/local/bin/sw-input', ...desktopInputArguments(action)], '/workspace', computerEnvironment('/workspace', true, '/home/worker'), 15_000)
  }
  private getScreenSize(container: Awaited<ReturnType<ManagedDockerComputer['ensure']>>) {
    if (!this.screenSize) {
      this.screenSize = execDocker(container, "xdpyinfo -display :1 | sed -n 's/.*dimensions:[[:space:]]*\\([0-9][0-9]*\\)x\\([0-9][0-9]*\\).*/\\1 \\2/p' | head -n 1", '/workspace', computerEnvironment('/workspace', true, '/home/worker'), 5000)
        .then((result) => {
          const match = /^(\d+) (\d+)\s*$/.exec(result.stdout)
          if (result.code !== 0 || !match) throw new Error('Could not determine desktop screen size')
          return { width: Number(match[1]), height: Number(match[2]) }
        })
      void this.screenSize.catch(() => { this.screenSize = undefined })
    }
    return this.screenSize
  }
  private async readiness() {
    const desktop = await this.desktop()
    const key = `${desktop.streamUrl}\n${desktop.cdpUrl}`
    if (!this.desktopStatus || this.desktopStatus.key !== key || Date.now() >= this.desktopStatus.expires) {
      const value = Promise.all([
        reachable(desktop.streamUrl, `Basic ${Buffer.from(`${desktop.viewer.user}:${desktop.viewer.password}`).toString('base64')}`),
        numericHttpEndpoint(new URL('/json/version', desktop.cdpUrl).toString()).then((url) => reachable(url)).catch(() => false),
      ]).then(([stream, cdp]) => ({ stream, cdp }))
      const cache = { key, expires: Date.now() + 5000, value }
      this.desktopStatus = cache
      void value.catch(() => { if (this.desktopStatus === cache) this.desktopStatus = undefined })
    }
    return { ...await this.desktopStatus.value, streamUrl: desktop.streamUrl, cdpUrl: desktop.cdpUrl }
  }
  override async restart() { this.desktopStatus = undefined; this.screenSize = undefined; await super.restart(); this.desktopStatus = undefined; this.screenSize = undefined }
  async status() {
    const failed = (error: string) => ({ provider: 'docker' as const, status: 'error' as const, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), error, desktop: { kind: 'proxied' as const, stream: false, cdp: false } })
    try { await this.pingDaemon() } catch { return failed('Docker daemon unavailable') }
    try {
      const container = await this.containerStatus()
      const desktop = container === 'ready' ? await this.readiness() : { stream: false, cdp: false }
      const detail = 'cdpUrl' in desktop && !desktop.cdp ? `CDP unreachable at ${diagnosticEndpoint(desktop.cdpUrl)}`
        : 'streamUrl' in desktop && !desktop.stream ? `Desktop unreachable at ${diagnosticEndpoint(desktop.streamUrl)}`
          : 'Persistent desktop container'
      return { provider: 'docker' as const, status: container === 'ready' && (!desktop.stream || !desktop.cdp) ? 'starting' as const : container, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), detail, desktop: { kind: 'proxied' as const, stream: desktop.stream, cdp: desktop.cdp } }
    } catch (error) { return failed(dockerDiagnostic(error)) }
  }
  async close() {}
}

export const dockerProvider: ComputerProvider = {
  id: 'docker', label: 'Docker', capabilities, credentialSchema: z.object({}), fields: [],
  async validateCredentials() { try { await dockerClient().ping() } catch { throw new Error('Docker daemon unavailable') } },
  async open({ workspaceRoot, instance }) {
    const passwords = await desktopPasswords(path.dirname(workspaceRoot))
    const computer = new ManagedDockerComputer(workspaceRoot, dockerClient(), instance?.externalId, passwords)
    await computer.initialize()
    return computer
  },
}
