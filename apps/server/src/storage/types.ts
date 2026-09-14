import path from 'node:path'
import { resolveJailedPath } from '../computer/path-jail.js'

export interface WorkspaceObject {
  key: string
  size: number
  etag?: string
  lastModified?: string
}

export interface WorkspaceStore {
  readonly kind: 'fs' | 's3'
  get(key: string): Promise<Uint8Array>
  put(key: string, data: Uint8Array, opts?: { contentType?: string }): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<WorkspaceObject[]>
  stat(key: string): Promise<{ size: number; etag?: string } | null>
  healthy(): Promise<void>
}

const JAIL_ROOT = path.resolve('/workspace')

export function workspaceKey(value: string, allowEmpty = false): string {
  if ((!value && allowEmpty) || (value.endsWith('/') && allowEmpty && value !== '/')) {
    const base = value.slice(0, -1)
    return base ? `${workspaceKey(base)}/` : ''
  }
  if (!value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) {
    throw new Error('Invalid workspace key')
  }
  let resolved: string
  try { resolved = resolveJailedPath(JAIL_ROOT, value) } catch { throw new Error('Invalid workspace key') }
  const normalized = path.relative(JAIL_ROOT, resolved).split(path.sep).join('/')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw new Error('Invalid workspace key')
  }
  return normalized
}
