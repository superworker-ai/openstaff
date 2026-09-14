import fs from 'node:fs/promises'
import path from 'node:path'
import { computerEnvironment } from './environment.js'
import { spawn } from 'node:child_process'
import { assertJailedRealPath, resolveJailedPath } from './path-jail.js'
import type { Computer, ExecOptions, ExecResult, FileStat } from './types.js'
import { capOutput as cap } from './output.js'

const MAX_OUTPUT_BYTES = 16 * 1024

export class LocalComputer implements Computer {
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    options.signal?.throwIfAborted()
    const cwd = resolveJailedPath(this.root, options.cwd ?? '.')
    await assertJailedRealPath(this.root, cwd)
    return new Promise((resolve, reject) => {
      const env = computerEnvironment(this.root)
      const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true })
      const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
      options.signal?.addEventListener('abort', kill, { once: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { if (Buffer.byteLength(stdout) <= MAX_OUTPUT_BYTES) stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { if (Buffer.byteLength(stderr) <= MAX_OUTPUT_BYTES) stderr += chunk.toString() })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; kill() }, options.timeoutMs ?? 120_000)
      child.once('error', (error) => { clearTimeout(timer); options.signal?.removeEventListener('abort', kill); reject(error) })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', kill)
        resolve({ stdout: cap(stdout), stderr: cap(signal ? `${stderr}\nTerminated: ${signal}` : stderr), code: timedOut ? 124 : code ?? 1 })
      })
    })
  }

  async readFile(filePath: string): Promise<string> {
    const resolved = resolveJailedPath(this.root, filePath)
    await assertJailedRealPath(this.root, resolved)
    return fs.readFile(resolved, 'utf8')
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const resolved = resolveJailedPath(this.root, filePath)
    await assertJailedRealPath(this.root, resolved)
    return new Uint8Array(await fs.readFile(resolved))
  }

  async writeFile(filePath: string, contents: string | Uint8Array): Promise<void> {
    const resolved = resolveJailedPath(this.root, filePath)
    await assertJailedRealPath(this.root, resolved, true)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, contents)
  }

  async mkdir(directoryPath: string): Promise<void> {
    const resolved = resolveJailedPath(this.root, directoryPath)
    await assertJailedRealPath(this.root, resolved, true)
    await fs.mkdir(resolved, { recursive: true })
  }

  async list(directoryPath: string): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>> {
    const resolved = resolveJailedPath(this.root, directoryPath)
    await assertJailedRealPath(this.root, resolved)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
    }))
  }

  async stat(filePath: string): Promise<FileStat> {
    const resolved = resolveJailedPath(this.root, filePath)
    await assertJailedRealPath(this.root, resolved)
    const value = await fs.stat(resolved)
    return { isFile: value.isFile(), isDirectory: value.isDirectory(), size: value.size }
  }
}
