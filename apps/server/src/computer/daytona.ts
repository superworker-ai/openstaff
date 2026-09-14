import { Daytona, DaytonaNotFoundError } from '@daytonaio/sdk'
import type { ComputerCapabilities, ComputerStatus } from '@openstaff/shared'
import { z } from 'zod'
import { resolveJailedPath } from './path-jail.js'
import { computerEnvironment } from './environment.js'
import { providerError, type ComputerProvider } from './provider.js'
import type { ExecOptions, FileStat, ManagedComputer } from './types.js'
import { capOutput as cap } from './output.js'

const ROOT = '/workspace'
const capabilities: ComputerCapabilities = { persistent: true, snapshots: true, explicitStop: true, hostFiles: false, desktop: false, volume: false }
const fields = [
  { name: 'apiKey', label: 'Daytona API key', secret: true, required: true, placeholder: '...' },
  { name: 'apiUrl', label: 'Daytona API URL', secret: false, required: false, placeholder: 'https://app.daytona.io/api' },
  { name: 'target', label: 'Daytona target', secret: false, required: false },
]
const credentials = z.object({ apiKey: z.string().min(1), apiUrl: z.string().optional(), target: z.string().optional() })
function remotePath(value: string) { return resolveJailedPath(ROOT, value).replaceAll('\\', '/') }
function client(values: z.infer<typeof credentials>) { return new Daytona({ apiKey: values.apiKey, apiUrl: values.apiUrl || undefined, target: values.target || undefined, otelEnabled: false }) }

class DaytonaComputer implements ManagedComputer {
  readonly root = ROOT
  private paused = false
  constructor(private readonly daytona: Daytona, private sandbox: Awaited<ReturnType<Daytona['get']>>) {}
  private async awake() { try { if (this.paused || this.sandbox.state !== 'started') await this.daytona.start(this.sandbox); this.paused = false } catch (error) { throw providerError('Daytona', error) } }
  async exec(command: string, options: ExecOptions = {}) {
    options.signal?.throwIfAborted()
    const cwd = remotePath(options.cwd ?? '.')
    const timeoutMs = options.timeoutMs ?? 120_000
    let cancel: (() => void) | undefined
    const abort = new Promise<never>((_, reject) => { cancel = () => reject(new Error('Aborted')); options.signal?.addEventListener('abort', cancel, { once: true }) })
    try {
      const execution = (async () => {
        await this.awake()
        options.signal?.throwIfAborted()
        return this.sandbox.process.executeCommand(command, cwd, computerEnvironment(ROOT, true), Math.ceil(timeoutMs / 1000))
      })()
      const result = await Promise.race([execution, abort])
      return { stdout: cap(result.result ?? ''), stderr: '', code: result.exitCode }
    } catch (error) {
      if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
      if (/timeout/i.test(error instanceof Error ? error.message : '')) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      throw providerError('Daytona', error)
    } finally { if (cancel) options.signal?.removeEventListener('abort', cancel) }
  }
  async readFile(filePath: string) { const target = remotePath(filePath); await this.awake(); try { return (await this.sandbox.fs.downloadFile(target)).toString('utf8') } catch (error) { throw providerError('Daytona', error) } }
  async readFileBytes(filePath: string) { const target = remotePath(filePath); await this.awake(); try { return new Uint8Array(await this.sandbox.fs.downloadFile(target)) } catch (error) { throw providerError('Daytona', error) } }
  async writeFile(filePath: string, contents: string | Uint8Array) { const target = remotePath(filePath); await this.awake(); try { await this.sandbox.fs.uploadFile(Buffer.from(contents), target) } catch (error) { throw providerError('Daytona', error) } }
  async mkdir(directoryPath: string) { const target = remotePath(directoryPath); await this.awake(); try { await this.sandbox.fs.createFolder(target, '755') } catch (error) { throw providerError('Daytona', error) } }
  async list(directoryPath: string) { const target = remotePath(directoryPath); await this.awake(); try { return (await this.sandbox.fs.listFiles(target)).map((item) => ({ name: item.name, type: item.isDir ? 'directory' as const : 'file' as const })) } catch (error) { throw providerError('Daytona', error) } }
  async stat(filePath: string): Promise<FileStat> { await this.awake(); const target = remotePath(filePath); const parent = remotePath(`${target}/..`); try { const item = (await this.sandbox.fs.listFiles(parent)).find((entry) => entry.path === target || entry.name === target.split('/').at(-1)); if (!item) throw new Error('Not found'); return { isFile: !item.isDir, isDirectory: item.isDir, size: item.size } } catch (error) { throw providerError('Daytona', error) } }
  async status(): Promise<ComputerStatus> { try { this.sandbox = await this.daytona.get(this.sandbox.id); this.paused = this.sandbox.state === 'paused' || this.sandbox.state === 'stopped'; const status: ComputerStatus['status'] = this.sandbox.state === 'error' ? 'error' : this.paused ? 'paused' : this.sandbox.state === 'started' ? 'ready' : 'starting'; return { provider: 'daytona', status, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), instanceId: this.sandbox.id, lastSeenAt: new Date().toISOString() } } catch (error) { return { provider: 'daytona', status: 'error', lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), error: providerError('Daytona', error).message, instanceId: this.sandbox.id } } }
  async restart() { await this.daytona.start(this.sandbox); this.paused = false }
  async stop() { await this.daytona.stop(this.sandbox); this.paused = true }
  async destroy() { await this.daytona.delete(this.sandbox) }
  async close() { await this.daytona[Symbol.asyncDispose]() }
}

export const daytonaProvider: ComputerProvider = {
  id: 'daytona', label: 'Daytona', capabilities, credentialSchema: credentials, fields,
  async validateCredentials(values) { const parsed = credentials.parse(values); try { const iterator = client(parsed).list(); await iterator.next() } catch (error) { throw providerError('Daytona', error, 'Daytona API key') } },
  async open({ credentials: values, instance, persist }) {
    const parsed = credentials.parse(values), daytona = client(parsed)
    try {
      let sandbox: Awaited<ReturnType<Daytona['get']>> | undefined
      if (instance) {
        try { sandbox = await daytona.get(instance.externalId) }
        catch (error) { if (!(error instanceof DaytonaNotFoundError)) throw error }
      }
      const created = !sandbox
      sandbox ??= await daytona.create({ snapshot: process.env.DAYTONA_SNAPSHOT || undefined })
      if (sandbox.state !== 'started') await daytona.start(sandbox)
      if (created) await persist({ externalId: sandbox.id, status: 'ready' })
      const computer = new DaytonaComputer(daytona, sandbox); await computer.mkdir(ROOT); return computer
    } catch (error) {
      await daytona[Symbol.asyncDispose]().catch(() => undefined)
      throw providerError('Daytona', error, 'Daytona API key')
    }
  },
}
