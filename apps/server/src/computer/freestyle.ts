import { Errors, Freestyle, type Vm } from 'freestyle-sandboxes'
import type { ComputerCapabilities, ComputerStatus } from '@openstaff/shared'
import { z } from 'zod'
import { computerEnvironment } from './environment.js'
import { freestyleError, freestyleInstanceGone } from './freestyle-errors.js'
import { capOutput } from './output.js'
import { resolveJailedPath } from './path-jail.js'
import type { ComputerProvider } from './provider.js'
import type { ExecOptions, FileStat, ManagedComputer } from './types.js'

const ROOT = '/workspace', TIMEOUT = 30 * 60_000
const capabilities: ComputerCapabilities = { persistent: true, snapshots: true, explicitStop: true, hostFiles: false, desktop: false, volume: false }
const fields = [
  { name: 'apiKey', label: 'Freestyle API key', secret: true, required: true, placeholder: 'fs_...' },
  { name: 'baseUrl', label: 'Freestyle base URL', secret: false, required: false, placeholder: 'https://api.freestyle.sh' },
]
const credentials = z.object({ apiKey: z.string().min(1), baseUrl: z.string().optional() })
const bootstrap = 'mkdir -p /workspace && probe=$(mktemp /workspace/.write-check.XXXXXX) && rm "$probe"'
function client(values: z.infer<typeof credentials>) { return new Freestyle({ apiKey: values.apiKey, baseUrl: values.baseUrl || undefined }) }
function remotePath(value: string) { return resolveJailedPath(ROOT, value).replaceAll('\\', '/') }
function quote(value: string) { return `'${value.replaceAll("'", `'\\''`)}'` }
function wrapped(command: string, cwd: string) {
  const env = Object.entries(computerEnvironment(ROOT, true)).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(([name, value]) => `${name}=${quote(value)}`).join(' ')
  return `cd ${quote(cwd)} && exec env -i ${env} sh -c ${quote(command)}`
}
function timedOut(error: unknown): boolean {
  const value = error as { constructor?: { name?: string; statusCode?: number }; name?: string }
  return value?.constructor?.statusCode === 504 || /timeout/i.test(value?.name ?? value?.constructor?.name ?? '')
}
async function bootstrapVm(vm: Vm): Promise<void> {
  const plain = await vm.exec({ command: bootstrap, timeoutMs: 30_000 })
  if ((plain.statusCode ?? 0) === 0) return
  const sudo = await vm.exec({ command: 'command -v sudo >/dev/null 2>&1', timeoutMs: 30_000 })
  if ((sudo.statusCode ?? 1) !== 0) throw new Error('Freestyle workspace bootstrap failed')
  const elevated = await vm.exec({ command: `sudo sh -c ${quote(bootstrap)}`, timeoutMs: 30_000 })
  if ((elevated.statusCode ?? 1) !== 0) throw new Error('Freestyle workspace bootstrap failed')
}

class FreestyleComputer implements ManagedComputer {
  readonly root = ROOT
  private state: 'starting' | 'running' | 'suspending' | 'suspended' | 'stopped' = 'running'
  private waking?: Promise<void>
  constructor(private readonly vm: Vm) {}
  private async awake(force = false) {
    if (!force && !['suspended', 'stopped'].includes(this.state)) return
    if (this.waking) return this.waking
    this.waking = this.vm.start().then(() => { this.state = 'running' }).finally(() => { this.waking = undefined })
    return this.waking
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.awake()
    try { return await operation() }
    catch (error) { if (!(error instanceof Errors.VmNotRunningError)) throw error; await this.awake(true); return operation() }
  }
  private async file<T>(operation: () => Promise<T>): Promise<T> { try { return await this.run(operation) } catch (error) { throw freestyleError(error) } }
  async exec(command: string, options: ExecOptions = {}) {
    if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
    const timeoutMs = options.timeoutMs ?? 120_000, cwd = remotePath(options.cwd ?? '.')
    let cancel: (() => void) | undefined
    const abort = new Promise<never>((_, reject) => { cancel = () => reject(new Error('Aborted')); options.signal?.addEventListener('abort', cancel, { once: true }) })
    try {
      const result = await Promise.race([this.run(() => this.vm.exec({ command: wrapped(command, cwd), timeoutMs })), abort])
      if (result.statusCode === 124) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      return { stdout: capOutput(result.stdout ?? ''), stderr: capOutput(result.stderr ?? ''), code: result.statusCode ?? 0 }
    } catch (error) {
      if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
      if (timedOut(error)) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      throw freestyleError(error)
    } finally { if (cancel) options.signal?.removeEventListener('abort', cancel) }
  }
  async readFile(filePath: string) { const target = remotePath(filePath); return this.file(async () => (await this.vm.fs.readFile(target)).toString('utf8')) }
  async readFileBytes(filePath: string) { const target = remotePath(filePath); return this.file(async () => new Uint8Array(await this.vm.fs.readFile(target))) }
  async writeFile(filePath: string, contents: string | Uint8Array) { const target = remotePath(filePath); await this.file(() => this.vm.fs.writeFile(target, Buffer.from(contents))) }
  async mkdir(directoryPath: string) { const target = remotePath(directoryPath); await this.file(() => this.vm.fs.mkdir(target, true)) }
  async list(directoryPath: string) { const target = remotePath(directoryPath); return this.file(async () => (await this.vm.fs.readDir(target)).map((item) => ({ name: item.name, type: item.kind === 'file' ? 'file' as const : item.kind === 'directory' ? 'directory' as const : 'other' as const }))) }
  async stat(filePath: string): Promise<FileStat> { const target = remotePath(filePath); return this.file(async () => { const item = await this.vm.fs.stat(target); return { isFile: item.isFile, isDirectory: item.isDirectory, size: item.size } }) }
  async status(): Promise<ComputerStatus> { try { const info = await this.vm.getInfo(); this.state = info.state; const status: ComputerStatus['status'] = info.state === 'running' ? 'ready' : info.state === 'starting' ? 'starting' : 'paused'; return { provider: 'freestyle', status, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), instanceId: this.vm.vmId, lastSeenAt: new Date().toISOString(), capabilities } } catch (error) { return { provider: 'freestyle', status: 'error', lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), error: freestyleError(error).message, instanceId: this.vm.vmId, capabilities } } }
  async restart() { try { await this.vm.start(); this.state = 'running' } catch (error) { throw freestyleError(error) } }
  async stop() { try { await this.vm.suspend(); this.state = 'suspended' } catch (error) { throw freestyleError(error) } }
  async destroy() { try { await this.vm.delete() } catch (error) { throw freestyleError(error) } }
  async close() {}
}

export const freestyleProvider: ComputerProvider = {
  id: 'freestyle', label: 'Freestyle', capabilities, credentialSchema: credentials, fields,
  async validateCredentials(values) { const parsed = credentials.parse(values); try { await client(parsed).whoami() } catch (error) { throw freestyleError(error) } },
  async open({ credentials: values, instance, persist }) {
    const parsed = credentials.parse(values), freestyle = client(parsed)
    let created: Vm | undefined
    try {
      let vm: Vm | undefined, state: Awaited<ReturnType<Vm['getInfo']>>['state'] | undefined
      if (instance) {
        try { vm = (await freestyle.vms.get({ vmId: instance.externalId })).vm; state = (await vm.getInfo()).state }
        catch (error) { if (!freestyleInstanceGone(error)) throw error; vm = undefined }
      }
      if (!vm) {
        const result = await freestyle.vms.create({ persistence: { type: 'persistent' }, idleTimeoutSeconds: TIMEOUT / 1000, workdir: ROOT, ...(process.env.FREESTYLE_SNAPSHOT_ID ? { snapshotId: process.env.FREESTYLE_SNAPSHOT_ID } : {}) })
        vm = created = result.vm
        state = (await vm.getInfo()).state
      }
      if (state !== 'running') { await vm.start(); state = 'running' }
      await bootstrapVm(vm)
      if (created) await persist({ externalId: vm.vmId, status: 'ready' })
      return new FreestyleComputer(vm)
    } catch (error) {
      if (created) await created.delete().catch(() => undefined)
      throw freestyleError(error)
    }
  },
}
