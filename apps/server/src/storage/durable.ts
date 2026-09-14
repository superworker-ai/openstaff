import { createHash } from 'node:crypto'
import path from 'node:path'
import { count, eq, like } from 'drizzle-orm'
import type { StorageStatus } from '@openstaff/shared'
import type { Computer } from '../computer/types.js'
import type { Database } from '../db/index.js'
import { durableFiles } from '../db/schema.js'
import { FsWorkspaceStore } from './fs.js'
import { workspaceStoreInfo } from './index.js'
import type { WorkspaceObject, WorkspaceStore } from './types.js'
import { workspaceKey } from './types.js'
import { scanComputer } from './scan.js'

export const DURABLE_PREFIXES = ['bots/', 'skills/', 'uploads/'] as const
export const MAX_DURABLE_FILE_BYTES = 20 * 1024 ** 2

export interface StorageAttachment {
  hostFiles: boolean
  root: string
}

export interface DurableWriteTarget extends Computer {
  storageAttachment(): Promise<StorageAttachment>
  markDurableMaterialized?(key: string): void
}

export interface ReconcileResult {
  uploaded: number
  deleted: number
  skipped: number
  warnings: string[]
  finishedAt: string
}

function sha256(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }
function durableKey(key: string): string {
  const safe = workspaceKey(key)
  if (!DURABLE_PREFIXES.some((prefix) => safe.startsWith(prefix))) throw new Error('Path is not durable')
  return safe
}

export class DurableWorkspace {
  private reconcileFlight?: Promise<ReconcileResult>
  private operation = Promise.resolve()
  private lastReconcileAt?: string
  private lastWarning?: string
  private healthCache?: { expires: number; value: Promise<boolean> }
  private readonly textCache = new Map<string, { hash: string; text: string }>()

  constructor(readonly store: WorkspaceStore, private readonly db: Database) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation
    let release!: () => void
    this.operation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }

  private direct(attachment: StorageAttachment): boolean {
    return this.store instanceof FsWorkspaceStore
      && attachment.hostFiles
      && path.resolve(attachment.root) === this.store.root
  }

  private async index(key: string, data: Uint8Array, source: string, updatedAt = new Date().toISOString(), mtime: string | null = null): Promise<void> {
    const hash = sha256(data)
    const description = /^skills\/[^/]+\/SKILL\.md$/.test(key) ? /^description:[ \t]*(.+)$/m.exec(Buffer.from(data).toString('utf8'))?.[1] ?? 'No description' : null
    await this.db.insert(durableFiles).values({ key, sha256: hash, size: data.byteLength, updatedAt, source, mtime, description }).onConflictDoUpdate({
      target: durableFiles.key,
      set: { sha256: hash, size: data.byteLength, updatedAt, source, mtime, description },
    })
    if (/^bots\/[^/]+\/MEMORY\.md$/.test(key)) this.textCache.set(key, { hash, text: Buffer.from(data).toString('utf8') })
  }

  private async putUnlocked(key: string, data: Uint8Array, opts: { contentType?: string; source?: string } = {}): Promise<void> {
    const safe = durableKey(key)
    await this.store.put(safe, data, { contentType: opts.contentType })
    await this.index(safe, data, opts.source ?? 'server')
  }

  async put(key: string, data: Uint8Array, opts: { contentType?: string; source?: string } = {}): Promise<void> {
    await this.exclusive(() => this.putUnlocked(key, data, opts))
  }

  async writeThrough(target: DurableWriteTarget, key: string, data: Uint8Array, opts: { contentType?: string; source?: string } = {}): Promise<void> {
    await this.exclusive(async () => {
      const safe = durableKey(key)
      await this.putUnlocked(safe, data, opts)
      if (!this.direct(await target.storageAttachment())) {
        await target.writeFile(safe, data)
        target.markDurableMaterialized?.(safe)
      }
    })
  }

  async get(key: string): Promise<Uint8Array> { return this.store.get(durableKey(key)) }
  async readText(key: string): Promise<string> {
    const safe = durableKey(key)
    const indexed = (await this.db.select({ hash: durableFiles.sha256 }).from(durableFiles).where(eq(durableFiles.key, safe)))[0]
    const cached = this.textCache.get(safe)
    if (indexed && cached?.hash === indexed.hash) return cached.text
    const text = Buffer.from(await this.get(safe)).toString('utf8')
    if (indexed && /^bots\/[^/]+\/MEMORY\.md$/.test(safe)) this.textCache.set(safe, { hash: indexed.hash, text })
    return text
  }
  async skillsIndex(): Promise<string> {
    const rows = await this.db.select({ key: durableFiles.key, description: durableFiles.description }).from(durableFiles).where(like(durableFiles.key, 'skills/%')).orderBy(durableFiles.key)
    return rows.flatMap((row) => {
      const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(row.key)
      return match ? [`${match[1]}: ${row.description ?? 'No description'}`] : []
    }).join('\n') || '(No skills saved yet.)'
  }
  async stat(key: string): Promise<{ size: number; etag?: string } | null> { return this.store.stat(durableKey(key)) }
  async list(prefix: string): Promise<WorkspaceObject[]> {
    const safe = workspaceKey(prefix, true)
    if (!DURABLE_PREFIXES.some((durable) => safe === durable || safe.startsWith(durable))) throw new Error('Prefix is not durable')
    return this.store.list(safe)
  }

  private async all(): Promise<WorkspaceObject[]> {
    const groups = await Promise.all(DURABLE_PREFIXES.map((prefix) => this.store.list(prefix)))
    return [...new Map(groups.flat().map((item) => [item.key, item])).values()].sort((left, right) => left.key.localeCompare(right.key))
  }

  async materialize(computer: Computer, attachment: StorageAttachment): Promise<Set<string>> {
    return this.exclusive(() => this.materializeUnlocked(computer, attachment))
  }

  private async materializeUnlocked(computer: Computer, attachment: StorageAttachment): Promise<Set<string>> {
    if (this.direct(attachment)) {
      // Bootstrap the index for existing host files without copying the workspace.
      await this.reconcileOnce(computer, attachment, new Set())
      return new Set()
    }
    for (const prefix of DURABLE_PREFIXES) await computer.mkdir(prefix.slice(0, -1))
    const materialized = new Set<string>()
    for (const object of await this.all()) {
      if (object.size > MAX_DURABLE_FILE_BYTES) {
        this.lastWarning = 'Skipped one durable file because it exceeds 20 MB'
        continue
      }
      const data = await this.store.get(object.key)
      await computer.writeFile(object.key, data)
      await this.index(object.key, data, 'storage', object.lastModified ?? new Date().toISOString())
      materialized.add(object.key)
    }
    return materialized
  }

  reconcile(computer: Computer, attachment: StorageAttachment, materialized: Set<string>): Promise<ReconcileResult> {
    if (!this.reconcileFlight) this.reconcileFlight = this.exclusive(() => this.reconcileOnce(computer, attachment, materialized)).finally(() => { this.reconcileFlight = undefined })
    return this.reconcileFlight
  }

  private async reconcileOnce(computer: Computer, attachment: StorageAttachment, materialized: Set<string>): Promise<ReconcileResult> {
    const warnings: string[] = []
    let uploaded = 0, deleted = 0, skipped = 0
    {
      const direct = this.direct(attachment)
      const indexed = await this.db.select().from(durableFiles)
      const files = new Map((await scanComputer(computer, indexed)).map((file) => [file.key, file]))
      const index = new Map(indexed.map((item) => [item.key, item]))
      for (const [key, file] of files) {
        const { size, mtime, sha256: digest } = file
        if (size > MAX_DURABLE_FILE_BYTES) {
          skipped += 1
          warnings.push('Skipped one durable file because it exceeds 20 MB')
          continue
        }
        const known = index.get(key)
        if (known?.size === size && known.mtime === mtime) continue
        if (!digest) {
          skipped += 1
          warnings.push('Skipped one durable file because its checksum was unavailable')
          continue
        }
        if (known?.size === size && known.sha256 === digest && (!key.startsWith('skills/') || known.description !== null)) {
          await this.db.update(durableFiles).set({ mtime }).where(eq(durableFiles.key, key))
          continue
        }
        const data = await computer.readFileBytes(key)
        if (data.byteLength > MAX_DURABLE_FILE_BYTES) {
          skipped += 1
          warnings.push('Skipped one durable file because it exceeds 20 MB')
          continue
        }
        if (data.byteLength !== size || sha256(data) !== digest) {
          skipped += 1
          warnings.push('Skipped one durable file because it changed during reconciliation')
          continue
        }
        if (!direct && known?.sha256 !== digest) { await this.store.put(key, data); uploaded += 1 }
        await this.index(key, data, 'computer', new Date().toISOString(), mtime)
      }
      for (const key of direct ? index.keys() : materialized) {
        if (files.has(key)) continue
        if (!direct) await this.store.delete(key)
        await this.db.delete(durableFiles).where(eq(durableFiles.key, key))
        this.textCache.delete(key)
        materialized.delete(key)
        deleted += 1
      }
    }
    const finishedAt = new Date().toISOString()
    this.lastReconcileAt = finishedAt
    this.lastWarning = warnings.at(-1)
    return { uploaded, deleted, skipped, warnings, finishedAt }
  }

  async status(checkHealth = true): Promise<StorageStatus> {
    if (checkHealth && (!this.healthCache || Date.now() >= this.healthCache.expires)) {
      const cache = { expires: Infinity, value: this.store.healthy().then(() => true, () => false) }
      this.healthCache = cache
      void cache.value.then(() => { cache.expires = Date.now() + 15_000 })
    }
    const healthy = await this.healthCache?.value ?? true
    const info = workspaceStoreInfo(this.store)
    const fileCount = (await this.db.select({ value: count() }).from(durableFiles))[0]!.value
    return {
      ...info,
      healthy,
      fileCount,
      lastReconcileAt: this.lastReconcileAt,
      lastWarning: this.lastWarning,
    }
  }
}
