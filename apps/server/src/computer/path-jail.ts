import fs from 'node:fs/promises'
import path from 'node:path'

export class PathJailError extends Error {
  constructor() {
    super('Path escapes the workspace')
    this.name = 'PathJailError'
  }
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

export function resolveJailedPath(rootInput: string, requestedPath: string): string {
  const root = path.resolve(rootInput)
  const normalized = requestedPath === '/workspace'
    ? '.'
    : requestedPath.startsWith('/workspace/')
      ? requestedPath.slice('/workspace/'.length)
      : requestedPath
  if (path.isAbsolute(normalized)) throw new PathJailError()
  const result = path.resolve(root, normalized || '.')
  if (!within(root, result)) throw new PathJailError()
  return result
}

export async function assertJailedRealPath(rootInput: string, candidate: string, allowMissing = false): Promise<void> {
  const root = await fs.realpath(path.resolve(rootInput))
  let current = candidate
  while (allowMissing) {
    try {
      const real = await fs.realpath(current)
      if (!within(root, real)) throw new PathJailError()
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw new PathJailError()
      current = parent
    }
  }
  const real = await fs.realpath(current)
  if (!within(root, real)) throw new PathJailError()
}
