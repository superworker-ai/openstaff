import { eq, inArray } from 'drizzle-orm'
import { COMPUTER_PROVIDERS, type ComputerProviderId, type ComputerProviderInfo, type ComputerStatus, type DesktopInputAction, type StorageStatus, type WorkspacePlan } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { computerInstances, turns, workspace } from '../db/schema.js'
import type { Secrets } from '../secrets.js'
import { ComputerCredentials } from './credentials.js'
import { computerProvider, computerProviders } from './registry.js'
import { ComputerError, type ComputerInstanceRecord } from './provider.js'
import type { Computer, DesktopEndpoints, ExecOptions, FileStat, ManagedComputer } from './types.js'
import type { ComputerLeaseSource } from './lease.js'
import type { DurableWorkspace, ReconcileResult, StorageAttachment } from '../storage/durable.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { checkComputerProviderPlan } from '../plan.js'
import { closeComputerSession, closeUnresumedComputerSessions, openComputerSession, type ComputerSessionEndReason } from './sessions.js'

function validProvider(value: string): value is ComputerProviderId { return (COMPUTER_PROVIDERS as readonly string[]).includes(value) }
function instance(row: typeof computerInstances.$inferSelect): ComputerInstanceRecord { return { ...row, metadata: row.metadata } }

export class ComputerConflictError extends ComputerError {
  constructor() { super('permanent', 'Cannot switch Computer while a turn is running or waiting') }
}

export class ComputerManager implements Computer {
  readonly root = '/workspace'
  private active?: { id: ComputerProviderId; computer: ManagedComputer; materialized: Set<string>; externalId?: string }
  private readonly credentials: ComputerCredentials
  private activeTurns = 0
  private operations = 0
  private opening?: Promise<ManagedComputer>
  private stopping?: Promise<void>
  private statusCache?: { expires: number; value: Promise<ComputerStatus> }
  private mayResume = true
  private idleTimer?: ReturnType<typeof setTimeout>
  private lease?: Pick<ComputerLeaseSource, 'current'>
  private unsubscribeLease?: () => void
  private hub?: Pick<RealtimeHub, 'broadcastAll'>
  private syncFlight?: Promise<ReconcileResult>
  private initialized = false
  constructor(private readonly workspaceRoot: string, private readonly db: Database, secrets: Secrets, private readonly durable?: DurableWorkspace, private readonly plan: WorkspacePlan = 'self-hosted', managedKeys = false) { this.credentials = new ComputerCredentials(db, secrets, managedKeys) }
  setLease(lease: ComputerLeaseSource) {
    this.unsubscribeLease?.()
    this.lease = lease
    this.unsubscribeLease = lease.onChange(async (current) => {
      if (current.ownerKind !== 'bot' || this.active?.id !== 'e2b') return
      try {
        const desktop = await this.active.computer.desktop?.()
        if (desktop?.kind === 'external') await desktop.revoke()
      } catch { console.warn('External desktop control revocation failed') }
    })
  }
  setHub(hub: Pick<RealtimeHub, 'broadcastAll'>) { this.hub = hub }
  async initialize(): Promise<void> {
    const first = !this.initialized
    this.initialized = true
    try {
      await this.resolve()
      await this.ensureSession()
      if (first) await closeUnresumedComputerSessions(this.db, this.active?.externalId ? { provider: this.active.id, externalId: this.active.externalId } : undefined)
      this.armIdle()
    } catch (error) {
      if (first) await closeUnresumedComputerSessions(this.db)
      throw error
    }
  }
  async driver(): Promise<ComputerProviderId> {
    const selected = process.env.COMPUTER_DRIVER || (await this.db.select({ computerDriver: workspace.computerDriver }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]?.computerDriver || 'local'
    if (!validProvider(selected)) throw new Error(`COMPUTER_DRIVER must be one of ${COMPUTER_PROVIDERS.join(', ')}`)
    if (selected === 'local' && this.plan !== 'self-hosted') throw new ComputerError('permanent', 'The local Computer is not available on this plan')
    return selected
  }
  async providerId(): Promise<ComputerProviderId> { return this.driver() }
  async desktopSupported(): Promise<boolean> {
    const id = await this.driver()
    return (this.active?.id === id ? this.active.computer.runtimeCapabilities : undefined)?.desktop ?? computerProvider(id).capabilities.desktop
  }
  private resolve(): Promise<ManagedComputer> {
    if (!this.opening) this.opening = this.open().finally(() => { this.opening = undefined })
    return this.opening
  }
  private async open(): Promise<ManagedComputer> {
    const id = await this.driver()
    if (this.active?.id === id) return this.active.computer
    await this.active?.computer.close().catch(() => undefined)
    const provider = computerProvider(id), resolved = await this.credentials.resolve(id)
    const row = (await this.db.select().from(computerInstances).where(eq(computerInstances.provider, id)).limit(1))[0]
    const recordId = row?.id ?? `cmp_${crypto.randomUUID()}`
    let currentMetadata = row?.metadata ?? {}, currentExternalId = row?.externalId ?? '', currentStatus = row?.status ?? 'starting'
    const persist = async (patch: Partial<ComputerInstanceRecord> & Pick<ComputerInstanceRecord, 'externalId' | 'status'>) => {
      const now = new Date().toISOString()
      currentMetadata = { ...currentMetadata, ...patch.metadata }
      currentExternalId = patch.externalId || currentExternalId
      currentStatus = patch.status || currentStatus
      const values = { id: recordId, provider: id, externalId: currentExternalId, status: currentStatus, createdAt: row?.createdAt ?? now, lastSeenAt: now, metadata: currentMetadata }
      await this.db.insert(computerInstances).values(values).onConflictDoUpdate({ target: computerInstances.provider, set: { externalId: values.externalId, status: values.status, lastSeenAt: now, metadata: values.metadata } })
      if (values.externalId && values.externalId !== row?.externalId) await openComputerSession(this.db, id, values.externalId, now)
      if (this.active?.id === id) this.active.externalId = values.externalId
    }
    const computer = await provider.open({ credentials: resolved.values, workspaceRoot: this.workspaceRoot, instanceId: recordId, instance: row ? instance(row) : null, persist })
    const attachment = { hostFiles: provider.capabilities.hostFiles, root: this.workspaceRoot }
    let materialized: Set<string>
    try { materialized = await this.durable?.materialize(computer, attachment) ?? new Set() }
    catch (error) { await computer.close().catch(() => undefined); throw error }
    this.active = { id, computer, materialized, externalId: currentExternalId || undefined }
    if (computer.notice) this.hub?.broadcastAll({ type: 'computer.notice', detail: computer.notice, ts: new Date().toISOString() })
    return computer
  }
  async status(): Promise<ComputerStatus> {
    if (!this.statusCache || Date.now() >= this.statusCache.expires) {
      const value = this.resolve().then(async (computer) => ({ ...await computer.status(), lockedByEnv: Boolean(process.env.COMPUTER_DRIVER) }))
      const cache = { expires: Infinity, value }
      this.statusCache = cache
      void value.then((status) => { if (this.statusCache === cache) { cache.expires = Date.now() + 15_000; this.mayResume = status.status !== 'ready' } }, () => {})
      void value.catch(() => { if (this.statusCache === cache) this.statusCache = undefined })
    }
    const status = await this.statusCache.value
    return this.lease ? { ...status, lease: await this.lease.current() } : status
  }
  async desktop(): Promise<DesktopEndpoints | null> {
    const computer = await this.resolve()
    return computer.desktop?.() ?? null
  }
  async captureScreen(options?: { quality?: number }) {
    return this.use((computer) => {
      if (!computer.captureScreen) throw new ComputerError('unavailable', 'Computer has no desktop')
      return computer.captureScreen(options)
    })
  }
  async desktopInput(action: DesktopInputAction): Promise<void> {
    return this.use((computer) => {
      if (!computer.desktopInput) throw new ComputerError('unavailable', 'Computer has no desktop')
      return computer.desktopInput(action)
    })
  }
  async restart() { this.statusCache = undefined; try { await this.use((computer) => computer.restart()); await this.ensureSession() } finally { this.statusCache = undefined } }
  private async stopFor(endReason: Extract<ComputerSessionEndReason, 'stopped' | 'idle'>) {
    this.cancelIdle(); this.statusCache = undefined
    if (!this.stopping) this.stopping = (this.active ? Promise.resolve(this.active.computer) : this.resolve()).then(async (computer) => {
      if (!computer.stop) throw new ComputerError('permanent', 'This Computer provider cannot stop instances')
      await computer.stop()
      if (this.active?.externalId) await closeComputerSession(this.db, this.active.id, endReason)
      this.mayResume = true
    }).finally(() => { this.stopping = undefined; this.statusCache = undefined })
    await this.stopping
  }
  async stop() { await this.stopFor('stopped') }
  async destroy() {
    this.cancelIdle(); await this.stopping
    const id = await this.driver(), computer = await this.resolve()
    try { await computer.destroy(); await closeComputerSession(this.db, id, 'destroyed'); await this.db.delete(computerInstances).where(eq(computerInstances.provider, id)); await this.release() }
    finally { this.statusCache = undefined }
  }
  async providers(): Promise<ComputerProviderInfo[]> {
    return Promise.all(computerProviders().map(async (provider) => {
      const resolved = await this.credentials.resolve(provider.id)
      const capabilities = this.active?.id === provider.id ? this.active.computer.runtimeCapabilities ?? provider.capabilities : provider.capabilities
      return { id: provider.id, label: provider.label, capabilities, fields: provider.fields, configured: provider.fields.length === 0 || resolved.source !== null, credentialSource: resolved.source, managed: this.credentials.isManaged(provider.id) }
    }))
  }
  async setProvider(id: ComputerProviderId): Promise<void> {
    const planLimit = checkComputerProviderPlan({ plan: this.plan }, id)
    if (planLimit) throw planLimit
    if (process.env.COMPUTER_DRIVER) throw new ComputerError('permanent', 'COMPUTER_DRIVER locks the selected provider')
    const busy = await this.db.select({ id: turns.id }).from(turns).where(inArray(turns.status, ['running', 'waiting_approval'])).limit(1)
    if (busy.length || this.activeTurns) throw new ComputerConflictError()
    await this.release()
    await this.db.update(workspace).set({ computerDriver: id }).where(eq(workspace.id, 'workspace'))
    await this.initialize()
  }
  async setCredentials(id: ComputerProviderId, values: Record<string, string>, updatedBy?: string) { const provider = computerProvider(id); const parsed = await provider.credentialSchema.parseAsync(values); await provider.validateCredentials(parsed); await this.credentials.set(id, parsed, updatedBy); await this.opening; if (this.active?.id === id) await this.release() }
  async clearCredentials(id: ComputerProviderId) { await this.credentials.clear(id); await this.opening; if (this.active?.id === id) await this.release() }
  async testCredentials(id: ComputerProviderId, values: Record<string, string>) { const provider = computerProvider(id); await provider.validateCredentials(await provider.credentialSchema.parseAsync(values)) }
  private async use<T>(fn: (computer: ManagedComputer) => Promise<T>): Promise<T> {
    this.operations += 1; this.cancelIdle()
    let resumed = false
    try {
      await this.stopping
      resumed = this.mayResume
      if (resumed) this.statusCache = undefined
      const result = await fn(await this.resolve())
      this.mayResume = false
      if (resumed) await this.ensureSession()
      return result
    } finally { this.operations -= 1; if (resumed) this.statusCache = undefined; this.armIdle() }
  }
  exec(command: string, options?: ExecOptions) { return this.use((computer) => computer.exec(command, options)) }
  readFile(filePath: string) { return this.use((computer) => computer.readFile(filePath)) }
  readFileBytes(filePath: string) { return this.use((computer) => computer.readFileBytes(filePath)) }
  writeFile(filePath: string, contents: string | Uint8Array) { return this.use((computer) => computer.writeFile(filePath, contents)) }
  mkdir(directoryPath: string) { return this.use((computer) => computer.mkdir(directoryPath)) }
  list(directoryPath: string) { return this.use((computer) => computer.list(directoryPath)) }
  stat(filePath: string): Promise<FileStat> { return this.use((computer) => computer.stat(filePath)) }
  private cancelIdle() { clearTimeout(this.idleTimer); this.idleTimer = undefined }
  private armIdle() {
    this.cancelIdle()
    if (this.activeTurns || this.operations || !this.active?.computer.stop) return
    const minutes = Number(process.env.COMPUTER_IDLE_MINUTES ?? 30)
    this.idleTimer = setTimeout(() => { void this.stopFor('idle').catch(() => undefined) }, Math.max(1, Number.isFinite(minutes) ? minutes : 30) * 60_000)
    this.idleTimer.unref()
  }
  turnStarted() { this.activeTurns += 1; this.cancelIdle() }
  turnFinished() {
    this.activeTurns = Math.max(0, this.activeTurns - 1)
    this.armIdle()
    if (this.durable) void this.syncStorage().catch(() => console.warn('Workspace storage reconcile failed'))
  }
  async storageAttachment(): Promise<StorageAttachment> {
    const provider = computerProvider(await this.driver())
    return { hostFiles: provider.capabilities.hostFiles, root: this.workspaceRoot }
  }
  markDurableMaterialized(key: string): void { this.active?.materialized.add(key) }
  async storageStatus(): Promise<StorageStatus> {
    if (!this.durable) throw new ComputerError('unavailable', 'Workspace storage is unavailable')
    return this.durable.status()
  }
  async syncStorage(): Promise<ReconcileResult> {
    if (!this.durable) throw new ComputerError('unavailable', 'Workspace storage is unavailable')
    if (!this.syncFlight) this.syncFlight = (async () => {
      const computer = await this.resolve(), active = this.active
      if (!active) throw new ComputerError('unavailable', 'Computer is unavailable')
      const result = await this.durable!.reconcile(computer, await this.storageAttachment(), active.materialized)
      this.hub?.broadcastAll({ type: 'computer.storage', storage: await this.durable!.status(false), ts: result.finishedAt })
      return result
    })().finally(() => { this.syncFlight = undefined })
    return this.syncFlight
  }
  private async ensureSession(): Promise<void> {
    if (this.active?.externalId) await openComputerSession(this.db, this.active.id, this.active.externalId)
  }
  private async release() {
    this.cancelIdle(); await this.opening; await this.stopping; await this.syncFlight
    await this.active?.computer.close().catch(() => undefined)
    this.active = undefined; this.statusCache = undefined; this.mayResume = true
  }
  async close() { this.unsubscribeLease?.(); this.unsubscribeLease = undefined; await this.release() }
}
