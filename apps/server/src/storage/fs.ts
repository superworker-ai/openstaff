import fs from 'node:fs/promises'
import path from 'node:path'
import { assertJailedRealPath, resolveJailedPath } from '../computer/path-jail.js'
import type { WorkspaceObject, WorkspaceStore } from './types.js'
import { workspaceKey } from './types.js'

export class FsWorkspaceStore implements WorkspaceStore {
  readonly kind = 'fs' as const
  readonly root: string

  constructor(root: string) { this.root = path.resolve(root) }

  private async target(key: string, allowMissing = false): Promise<string> {
    const target = resolveJailedPath(this.root, workspaceKey(key))
    await fs.mkdir(this.root, { recursive: true })
    await assertJailedRealPath(this.root, target, allowMissing)
    return target
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(await this.target(key)))
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const target = await this.target(key, true)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }

  async delete(key: string): Promise<void> {
    await fs.rm(await this.target(key, true), { force: true })
  }

  async list(prefix: string): Promise<WorkspaceObject[]> {
    const safePrefix = workspaceKey(prefix, true)
    await fs.mkdir(this.root, { recursive: true })
    const entries = await fs.readdir(this.root, { recursive: true, withFileTypes: true })
    const objects: WorkspaceObject[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const absolute = path.join(entry.parentPath, entry.name)
      await assertJailedRealPath(this.root, absolute)
      const key = path.relative(this.root, absolute).split(path.sep).join('/')
      if (!key.startsWith(safePrefix)) continue
      const stat = await fs.stat(absolute)
      objects.push({ key, size: stat.size, lastModified: stat.mtime.toISOString() })
    }
    return objects.sort((left, right) => left.key.localeCompare(right.key))
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const value = await fs.stat(await this.target(key))
      return value.isFile() ? { size: value.size } : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async healthy(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    await fs.access(this.root, fs.constants.R_OK | fs.constants.W_OK)
  }
}
