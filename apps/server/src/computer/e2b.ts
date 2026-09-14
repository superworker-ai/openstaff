import { Sandbox as DesktopSandbox } from '@e2b/desktop'
import { CommandExitError, Sandbox, TimeoutError, Volume, VolumeNotFoundError } from 'e2b'
import type { ComputerCapabilities, DesktopInputAction } from '@openstaff/shared'
import { z } from 'zod'
import { resolveJailedPath } from './path-jail.js'
import { computerEnvironment } from './environment.js'
import { e2bError, e2bInstanceGone } from './e2b-errors.js'
import { capOutput } from './output.js'
import type { ComputerProvider } from './provider.js'
import type { ExecOptions, FileStat, ManagedComputer } from './types.js'
import { E2BDesktop } from './e2b-desktop.js'

const ROOT = '/workspace', TIMEOUT = 30 * 60_000, REFRESH = 5 * 60_000
const baseCapabilities: ComputerCapabilities = { persistent: true, snapshots: true, explicitStop: true, hostFiles: false, desktop: false, volume: true }
const fields = [{ name: 'apiKey', label: 'E2B API key', secret: true, required: true, placeholder: 'e2b_...' }]
const credentials = z.object({ apiKey: z.string().min(1) })
function remotePath(value: string) { return resolveJailedPath(ROOT, value).replaceAll('\\', '/') }
function metadataString(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined }
function volumePlanError(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number; response?: { status?: number }; message?: string }
  const status = value?.status ?? value?.statusCode ?? value?.response?.status
  return status === 402 || status === 403 || /plan|permission|upgrade|not available|not enabled/i.test(value?.message ?? '')
}
function volumeName(instanceId: string): string { return `openstaff-workspace-${instanceId.replace(/[^a-zA-Z0-9-]/g, '-')}` }
function desktopEnabled(): boolean { return process.env.E2B_DESKTOP !== '0' }
function capabilities(): ComputerCapabilities { return { ...baseCapabilities, desktop: desktopEnabled() } }

async function openVolume(apiKey: string, instanceId: string, instance: Parameters<ComputerProvider['open']>[0]['instance']): Promise<{ volume?: Volume; created: boolean; unavailable: boolean; name: string }> {
  const name = metadataString(instance?.metadata.e2bVolumeName) ?? volumeName(instanceId)
  if (instance?.metadata.e2bVolumeUnavailable === true) return { created: false, unavailable: true, name }
  const id = metadataString(instance?.metadata.e2bVolumeId)
  if (id) {
    try { return { volume: await Volume.connect(id, { apiKey }), created: false, unavailable: false, name } }
    catch (error) { if (!(error instanceof VolumeNotFoundError)) throw error }
  }
  try {
    const listed = (await Volume.list({ apiKey })).find((item) => item.name === name)
    if (listed) return { volume: await Volume.connect(listed.volumeId, { apiKey }), created: false, unavailable: false, name }
    return { volume: await Volume.create(name, { apiKey }), created: true, unavailable: false, name }
  } catch (error) {
    if (volumePlanError(error)) return { created: false, unavailable: true, name }
    throw error
  }
}

class E2BComputer implements ManagedComputer {
  readonly root = ROOT
  readonly runtimeCapabilities: ComputerCapabilities
  private paused = false
  private refreshedAt = Date.now()
  private waking?: Promise<void>
  private readonly desktopDriver?: E2BDesktop
  private readonly withDesktop: boolean
  constructor(private sandbox: Sandbox, private readonly apiKey: string, private readonly externalId: string, private readonly volumeId?: string, readonly notice?: string, private readonly detail?: string, private readonly template?: string, withDesktop = false) {
    this.withDesktop = withDesktop
    this.runtimeCapabilities = { ...capabilities(), desktop: withDesktop, volume: Boolean(volumeId) }
    if (withDesktop) this.desktopDriver = new E2BDesktop(sandbox as DesktopSandbox)
  }
  private async awake(reconnect = false) {
    if (this.waking) return this.waking
    this.waking = (async () => {
      if (reconnect || this.paused) {
        this.sandbox = this.withDesktop
          ? await (this.sandbox as DesktopSandbox).connect({ apiKey: this.apiKey, timeoutMs: TIMEOUT })
          : await Sandbox.connect(this.externalId, { apiKey: this.apiKey, timeoutMs: TIMEOUT })
        if (this.desktopDriver) await this.desktopDriver.afterResume(this.sandbox as DesktopSandbox)
        this.paused = false; this.refreshedAt = Date.now()
      } else if (Date.now() - this.refreshedAt >= REFRESH) {
        await Sandbox.setTimeout(this.externalId, TIMEOUT, { apiKey: this.apiKey })
        this.refreshedAt = Date.now()
      }
    })().finally(() => { this.waking = undefined })
    return this.waking
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { await this.awake(); return await operation() }
    catch (error) {
      if (!await this.recoverable(error)) throw error
      // SandboxNotFoundError also means not running. Resume once, never loop.
      await this.awake(true)
      return operation()
    }
  }
  private async recoverable(error: unknown): Promise<boolean> {
    if (e2bInstanceGone(error)) return true
    // The installed SDK also maps envd's 502 (paused/expired) to TimeoutError.
    // Probe only on this error: never replay an ordinary command timeout.
    if (!(error instanceof TimeoutError)) return false
    try { return (await Sandbox.getInfo(this.externalId, { apiKey: this.apiKey })).state === 'paused' }
    catch (probeError) { if (e2bInstanceGone(probeError)) return true; throw probeError }
  }
  private async file<T>(operation: () => Promise<T>): Promise<T> {
    try { return await this.run(operation) } catch (error) { throw e2bError(error) }
  }
  async initializeDesktop(): Promise<void> { if (this.desktopDriver) await this.file(() => this.desktopDriver!.initialize()) }
  async exec(command: string, options: ExecOptions = {}) {
    options.signal?.throwIfAborted()
    const cwd = remotePath(options.cwd ?? '.')
    try {
      const result = await this.run(() => {
        options.signal?.throwIfAborted()
        return this.sandbox.commands.run(command, { cwd, envs: computerEnvironment(ROOT, true), timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal })
      })
      return { stdout: capOutput(result.stdout), stderr: capOutput(result.stderr), code: result.exitCode }
    } catch (error) {
      if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
      if (error instanceof TimeoutError) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      if (error instanceof CommandExitError) return { stdout: capOutput(error.stdout), stderr: capOutput(error.stderr), code: error.exitCode }
      throw e2bError(error)
    }
  }
  async readFile(filePath: string) { const target = remotePath(filePath); return this.file(() => this.sandbox.files.read(target)) }
  async readFileBytes(filePath: string) { const target = remotePath(filePath); return this.file(() => this.sandbox.files.read(target, { format: 'bytes' })) }
  async writeFile(filePath: string, contents: string | Uint8Array) { const target = remotePath(filePath), data = typeof contents === 'string' ? contents : new Uint8Array(contents).buffer; await this.file(() => this.sandbox.files.write(target, data)) }
  async mkdir(directoryPath: string) { const target = remotePath(directoryPath); await this.file(() => this.sandbox.files.makeDir(target)) }
  async list(directoryPath: string) { const target = remotePath(directoryPath); return this.file(async () => (await this.sandbox.files.list(target)).map((item) => ({ name: item.name, type: item.type === 'file' ? 'file' as const : item.type === 'dir' ? 'directory' as const : 'other' as const }))) }
  async stat(filePath: string): Promise<FileStat> { const target = remotePath(filePath); return this.file(async () => { const item = await this.sandbox.files.getInfo(target); return { isFile: item.type === 'file', isDirectory: item.type === 'dir', size: item.size } }) }
  async desktop() {
    if (!this.desktopDriver) return null
    await this.file(() => this.desktopDriver!.initialize())
    return {
      kind: 'external' as const,
      cdpUrl: this.desktopDriver.cdpUrl,
      viewerUrl: () => this.file(() => this.desktopDriver!.viewerUrl()),
      controllerUrl: () => this.file(() => this.desktopDriver!.controllerUrl()),
      revoke: () => this.file(() => this.desktopDriver!.revoke()),
    }
  }
  async captureScreen() {
    if (!this.desktopDriver) throw new Error('Computer has no desktop')
    return this.file(() => this.desktopDriver!.captureScreen())
  }
  async desktopInput(action: DesktopInputAction): Promise<void> {
    if (!this.desktopDriver) throw new Error('Computer has no desktop')
    await this.file(() => this.desktopDriver!.input(action))
  }
  async desktopCursor() {
    if (!this.desktopDriver) throw new Error('Computer has no desktop')
    return this.file(() => this.desktopDriver!.cursor())
  }
  async desktopWindows() {
    if (!this.desktopDriver) throw new Error('Computer has no desktop')
    return this.file(() => this.desktopDriver!.windows())
  }
  async focusDesktopWindow(input: { id?: string; titleContains?: string }): Promise<void> {
    if (!this.desktopDriver) throw new Error('Computer has no desktop')
    await this.file(() => this.desktopDriver!.focus(input))
  }
  private statusDetail(): string | undefined {
    const browser = this.desktopDriver?.installedChromium ? 'Chromium was installed during the first desktop open, which added package-download startup time' : undefined
    return [this.detail, browser].filter(Boolean).join('; ') || undefined
  }
  async status() {
    try {
      const info = await Sandbox.getInfo(this.externalId, { apiKey: this.apiKey })
      this.paused = info.state === 'paused'
      const desktop = this.desktopDriver
        ? { kind: 'external' as const, ...(this.paused ? { stream: false, cdp: false } : await this.desktopDriver.status()), template: this.template }
        : undefined
      const status = this.paused ? 'paused' as const : desktop && (!desktop.stream || !desktop.cdp) ? 'starting' as const : 'ready' as const
      return { provider: 'e2b' as const, status, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), instanceId: this.externalId, lastSeenAt: new Date().toISOString(), detail: this.statusDetail(), capabilities: this.runtimeCapabilities, ...(desktop ? { desktop } : {}) }
    } catch (error) { return { provider: 'e2b' as const, status: 'error' as const, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), error: e2bError(error).message, instanceId: this.externalId, detail: this.statusDetail(), capabilities: this.runtimeCapabilities, ...(this.desktopDriver ? { desktop: { kind: 'external' as const, stream: false, cdp: false, template: this.template } } : {}) } }
  }
  async restart() { try { await this.awake(true) } catch (error) { throw e2bError(error) } }
  async stop() { try { if (this.desktopDriver) await this.desktopDriver.beforePause(); await Sandbox.pause(this.externalId, { apiKey: this.apiKey }); this.paused = true } catch (error) { throw e2bError(error) } }
  async destroy() {
    let failure: unknown
    try { await Sandbox.kill(this.externalId, { apiKey: this.apiKey }) } catch (error) { failure = error }
    try { if (this.volumeId) await Volume.destroy(this.volumeId, { apiKey: this.apiKey }) } catch (error) { failure ??= error }
    if (failure) throw e2bError(failure)
  }
  async close() {}
}

export const e2bProvider: ComputerProvider = {
  id: 'e2b', label: 'E2B', get capabilities() { return capabilities() }, credentialSchema: credentials, fields,
  async validateCredentials(values) { const parsed = credentials.parse(values); try { await Sandbox.list({ apiKey: parsed.apiKey, limit: 1 }).nextItems() } catch (error) { throw e2bError(error) } },
  async open({ credentials: values, instanceId, instance, persist }) {
    const parsed = credentials.parse(values)
    let created: Sandbox | undefined
    let createdVolume: Volume | undefined
    try {
      let sandbox: Sandbox | undefined
      let recreated = false
      const withDesktop = desktopEnabled()
      const template = withDesktop ? process.env.E2B_DESKTOP_TEMPLATE ?? 'desktop' : process.env.E2B_TEMPLATE ?? 'base'
      if (instance && withDesktop && instance.metadata.e2bDesktop !== true) {
        console.info(instance.metadata.e2bVolumeId ? 'Replacing legacy E2B sandbox with desktop template; workspace volume will be reused' : 'Replacing legacy E2B sandbox with desktop template; durable workspace files will be restored')
        try { await Sandbox.kill(instance.externalId, { apiKey: parsed.apiKey }) } catch (error) { if (!e2bInstanceGone(error)) throw error }
        recreated = true
      } else if (instance) {
        try { sandbox = withDesktop
          ? await DesktopSandbox.connect(instance.externalId, { apiKey: parsed.apiKey, timeoutMs: TIMEOUT })
          : await Sandbox.connect(instance.externalId, { apiKey: parsed.apiKey, timeoutMs: TIMEOUT }) }
        catch (error) { if (!e2bInstanceGone(error)) throw error }
      }
      let attachedVolumeId = metadataString(instance?.metadata.e2bVolumeId)
      let volumeUnavailable = instance?.metadata.e2bVolumeUnavailable === true
      let detail = metadataString(instance?.metadata.e2bRecreationDetail)
      if (!sandbox) {
        recreated ||= Boolean(instance)
        const attachment = await openVolume(parsed.apiKey, instanceId, instance)
        createdVolume = attachment.created ? attachment.volume : undefined
        attachedVolumeId = attachment.volume?.volumeId
        volumeUnavailable = attachment.unavailable
        const options = { apiKey: parsed.apiKey, timeoutMs: TIMEOUT, ...(attachment.volume ? { volumeMounts: { [ROOT]: attachment.volume } } : {}) }
        sandbox = created = withDesktop
          ? await DesktopSandbox.create(template, { ...options, resolution: [1280, 800] })
          : await Sandbox.create(template, options)
        const recreatedAt = new Date().toISOString()
        detail = recreated
          ? attachedVolumeId
            ? `Recreated ${recreatedAt}; workspace preserved by volume`
            : `Recreated ${recreatedAt}; durable files were restored from storage; other files were lost`
          : volumeUnavailable ? 'E2B volumes are unavailable for this account; durable storage sync is active' : undefined
        await persist({
          externalId: sandbox.sandboxId,
          status: recreated ? 'recreated' : 'ready',
          metadata: {
            e2bVolumeName: attachment.name,
            ...(attachedVolumeId ? { e2bVolumeId: attachedVolumeId } : {}),
            e2bVolumeUnavailable: volumeUnavailable,
            ...(withDesktop ? { e2bDesktop: true, e2bDesktopTemplate: template } : {}),
            ...(detail ? { e2bRecreationDetail: detail } : {}),
          },
        })
      } else if (!attachedVolumeId) {
        detail ??= volumeUnavailable
          ? 'E2B volumes are unavailable for this account; durable storage sync is active'
          : 'An E2B volume will be attached when this sandbox is recreated'
      }
      // The base template's shell user cannot create directories under /. Bootstrap
      // without cwd/HOME overrides, then prove a shell write before exposing the root.
      await sandbox.commands.run('sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace && probe=$(mktemp /workspace/.write-check.XXXXXX) && rm "$probe"', { timeoutMs: 30_000 })
      const notice = recreated || instance?.status === 'recreated' ? detail : undefined
      const computer = new E2BComputer(sandbox, parsed.apiKey, sandbox.sandboxId, attachedVolumeId, notice, detail, template, withDesktop)
      await computer.initializeDesktop()
      return computer
    } catch (error) {
      // Failed initialization must not leak a newly provisioned sandbox. Never
      // destroy an attached workspace when its bootstrap fails.
      if (created) await Sandbox.kill(created.sandboxId, { apiKey: parsed.apiKey }).catch(() => undefined)
      if (createdVolume) await Volume.destroy(createdVolume.volumeId, { apiKey: parsed.apiKey }).catch(() => undefined)
      throw e2bError(error)
    }
  },
}
