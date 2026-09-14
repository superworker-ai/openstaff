import { APIError, Sandbox } from '@vercel/sandbox'
import type { ComputerCapabilities, ComputerStatus } from '@openstaff/shared'
import { z } from 'zod'
import { computerEnvironment } from './environment.js'
import { capOutput } from './output.js'
import { resolveJailedPath } from './path-jail.js'
import type { ComputerProvider } from './provider.js'
import type { ExecOptions, FileStat, ManagedComputer } from './types.js'
import { vercelError, vercelInstanceGone } from './vercel-errors.js'

const ROOT = '/workspace', TIMEOUT = 30 * 60_000, REFRESH = 5 * 60_000
const capabilities: ComputerCapabilities = { persistent: true, snapshots: true, explicitStop: true, hostFiles: false, desktop: false, volume: false }
const fields = [
  { name: 'token', label: 'Vercel token', secret: true, required: true, placeholder: 'Vercel access token' },
  { name: 'teamId', label: 'Vercel team ID', secret: false, required: true, placeholder: 'team_...' },
  { name: 'projectId', label: 'Vercel project ID', secret: false, required: true, placeholder: 'prj_...' },
]
const credentials = z.object({ token: z.string().min(1), teamId: z.string().min(1), projectId: z.string().min(1) })
const probe = 'probe=$(mktemp /workspace/.write-check.XXXXXX) && rm "$probe"'
function remotePath(value: string) { return resolveJailedPath(ROOT, value).replaceAll('\\', '/') }
function quote(value: string) { return `'${value.replaceAll("'", `'\\''`)}'` }
function params(values: z.infer<typeof credentials>) { return { token: values.token, teamId: values.teamId, projectId: values.projectId } }
function timedOut(error: unknown): boolean { return error instanceof APIError ? error.response.status === 408 || error.response.status === 504 : /timeout/i.test((error as { name?: string })?.name ?? '') }
async function checked(command: Sandbox, input: Parameters<Sandbox['runCommand']>[0]) {
  const result = await command.runCommand(input)
  if (result.exitCode !== 0) throw new Error('Vercel Sandbox workspace bootstrap failed')
}
async function bootstrapSandbox(sandbox: Sandbox) {
  const { username } = await sandbox.getDefaultUser()
  await checked(sandbox, { cmd: 'sh', args: ['-c', `mkdir -p /workspace && chown ${quote(username)} /workspace`], sudo: true, timeoutMs: 30_000 })
  await checked(sandbox, { cmd: 'sh', args: ['-c', probe], timeoutMs: 30_000 })
}

class VercelComputer implements ManagedComputer {
  readonly root = ROOT
  private refreshedAt = Date.now()
  private waking?: Promise<void>
  constructor(private sandbox: Sandbox, private readonly values: z.infer<typeof credentials>) {}
  private async awake() {
    if (Date.now() - this.refreshedAt < REFRESH) return
    if (this.waking) return this.waking
    // Best effort: a plan cap or transient failure must not block the operation; the SDK resumes a stopped session itself.
    this.waking = this.sandbox.extendTimeout(REFRESH).catch(() => undefined).then(() => { this.refreshedAt = Date.now() }).finally(() => { this.waking = undefined })
    return this.waking
  }
  private async file<T>(operation: () => Promise<T>): Promise<T> { try { await this.awake(); return await operation() } catch (error) { throw vercelError(error) } }
  async exec(command: string, options: ExecOptions = {}) {
    if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
    const timeoutMs = options.timeoutMs ?? 120_000
    try {
      await this.awake()
      const started = Date.now()
      const result = await this.sandbox.runCommand({ cmd: 'sh', args: ['-c', command], cwd: remotePath(options.cwd ?? '.'), env: computerEnvironment(ROOT, true), timeoutMs, signal: options.signal })
      // The sandbox enforces timeoutMs with SIGKILL (137). Only report a timeout once the deadline actually elapsed, so an OOM kill keeps its output.
      if (result.exitCode === 137 && Math.max(Date.now() - started, result.durationMs ?? 0) >= timeoutMs) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()])
      return { stdout: capOutput(stdout), stderr: capOutput(stderr), code: result.exitCode }
    } catch (error) {
      if (options.signal?.aborted) return { stdout: '', stderr: 'Terminated: aborted', code: 130 }
      if (timedOut(error)) return { stdout: '', stderr: 'Terminated: timeout', code: 124 }
      throw vercelError(error)
    }
  }
  async readFile(filePath: string) { const target = remotePath(filePath); return this.file(() => this.sandbox.fs.readFile(target, 'utf8')) }
  async readFileBytes(filePath: string) { const target = remotePath(filePath); return this.file(async () => new Uint8Array(await this.sandbox.fs.readFile(target))) }
  async writeFile(filePath: string, contents: string | Uint8Array) { const target = remotePath(filePath); await this.file(() => this.sandbox.fs.writeFile(target, contents)) }
  async mkdir(directoryPath: string) { const target = remotePath(directoryPath); await this.file(() => this.sandbox.fs.mkdir(target, { recursive: true }).then(() => undefined)) }
  async list(directoryPath: string) { const target = remotePath(directoryPath); return this.file(async () => (await this.sandbox.fs.readdir(target, { withFileTypes: true })).map((item) => ({ name: item.name, type: item.isFile() ? 'file' as const : item.isDirectory() ? 'directory' as const : 'other' as const }))) }
  async stat(filePath: string): Promise<FileStat> { const target = remotePath(filePath); return this.file(async () => { const item = await this.sandbox.fs.stat(target); return { isFile: item.isFile(), isDirectory: item.isDirectory(), size: item.size } }) }
  async status(): Promise<ComputerStatus> { try { this.sandbox = await Sandbox.get({ name: this.sandbox.name, ...params(this.values) }); const status: ComputerStatus['status'] = this.sandbox.status === 'running' ? 'ready' : this.sandbox.status === 'stopped' ? 'paused' : this.sandbox.status === 'failed' || this.sandbox.status === 'aborted' ? 'error' : 'starting'; return { provider: 'vercel', status, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), instanceId: this.sandbox.name, lastSeenAt: new Date().toISOString(), capabilities } } catch (error) { return { provider: 'vercel', status: 'error', lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), error: vercelError(error).message, instanceId: this.sandbox.name, capabilities } } }
  async restart() { try { this.sandbox = await Sandbox.get({ name: this.sandbox.name, resume: true, ...params(this.values) }); this.refreshedAt = Date.now() } catch (error) { throw vercelError(error) } }
  async stop() { try { await this.sandbox.stop() } catch (error) { throw vercelError(error) } }
  async destroy() { try { await this.sandbox.delete({ deleteOrphanSnapshots: true }) } catch (error) { throw vercelError(error) } }
  async close() {}
}

export const vercelProvider: ComputerProvider = {
  id: 'vercel', label: 'Vercel Sandbox', capabilities, credentialSchema: credentials, fields,
  async validateCredentials(values) { const parsed = credentials.parse(values); try { await Sandbox.list({ ...params(parsed), limit: 1 }) } catch (error) { throw vercelError(error) } },
  async open({ credentials: values, instance, persist }) {
    const parsed = credentials.parse(values), auth = params(parsed)
    let created: Awaited<ReturnType<typeof Sandbox.create>> | undefined
    try {
      let sandbox: Sandbox | undefined
      if (instance) { try { sandbox = await Sandbox.get({ name: instance.externalId, ...auth }) } catch (error) { if (!vercelInstanceGone(error)) throw error } }
      if (!sandbox) sandbox = created = await Sandbox.create({ ...auth, persistent: true, timeout: TIMEOUT, ...(process.env.VERCEL_SANDBOX_IMAGE ? { image: process.env.VERCEL_SANDBOX_IMAGE } : {}) })
      await bootstrapSandbox(sandbox)
      if (created) await persist({ externalId: sandbox.name, status: 'ready' })
      return new VercelComputer(sandbox, parsed)
    } catch (error) {
      if (created) await created.delete().catch(() => undefined)
      throw vercelError(error)
    }
  },
}
