import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalComputer } from './local.js'
import { PathJailError, resolveJailedPath } from './path-jail.js'

describe('workspace path jail', () => {
  let root = ''
  let computer: LocalComputer

  beforeEach(async () => {
    root = await fs.mkdtemp(path.resolve('data-test-jail-'))
    computer = new LocalComputer(path.join(root, 'workspace'))
    await computer.initialize()
  })

  afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }) })

  it('scrubs secrets from shell commands and permits explicit computer variables', async () => {
    vi.stubEnv('XAI_API_KEY', 'canary-never-expose')
    vi.stubEnv('COMPUTER_ENV_VISIBLE', 'allowed-value')
    const result = await computer.exec('printenv')
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('canary-never-expose')
    expect(result.stdout).not.toContain('XAI_API_KEY')
    expect(result.stdout).toContain('VISIBLE=allowed-value')
    expect(result.stdout).toContain(`HOME=${computer.root}`)
    expect(result.stdout).toContain('TERM=dumb')
  })

  it('maps relative and virtual workspace paths under the root', () => {
    expect(resolveJailedPath(computer.root, 'notes/a.md')).toBe(path.join(computer.root, 'notes/a.md'))
    expect(resolveJailedPath(computer.root, '/workspace/notes/a.md')).toBe(path.join(computer.root, 'notes/a.md'))
  })

  it('cancels the shell process group promptly', async () => {
    const controller = new AbortController()
    const result = computer.exec('sleep 20', { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    expect((await result).code).not.toBe(0)
  })

  it('rejects lexical traversal and absolute host paths', () => {
    expect(() => resolveJailedPath(computer.root, '../secret')).toThrow(PathJailError)
    expect(() => resolveJailedPath(computer.root, '/etc/passwd')).toThrow(PathJailError)
  })

  it('reads and writes files inside the workspace', async () => {
    await computer.writeFile('notes/a.md', 'hello')
    await expect(computer.readFile('/workspace/notes/a.md')).resolves.toBe('hello')
  })

  it('rejects symlinks that escape the workspace', async () => {
    await fs.symlink(root, path.join(computer.root, 'outside'))
    await expect(computer.writeFile('outside/secret.txt', 'nope')).rejects.toThrow(PathJailError)
  })
})
