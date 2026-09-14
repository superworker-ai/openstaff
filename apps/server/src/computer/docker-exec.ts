import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type Docker from 'dockerode'
import type { ExecResult } from './types.js'
import { capOutput } from './output.js'

const TEXT_LIMIT = 16 * 1024
export const BINARY_LIMIT = 8 * 1024 * 1024

interface RawExecResult {
  stdout: Buffer
  stderr: Buffer
  code: number
  timedOut: boolean
  overflowed: boolean
}

function append(buffer: Buffer, chunk: Buffer, limit: number): { value: Buffer; overflowed: boolean } {
  const remaining = Math.max(0, limit - buffer.length)
  return { value: remaining ? Buffer.concat([buffer, chunk.subarray(0, remaining)]) : buffer, overflowed: chunk.length > remaining }
}

async function runDockerExec(container: Docker.Container, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number, stdoutLimit: number, signal?: AbortSignal): Promise<RawExecResult> {
  signal?.throwIfAborted()
  const marker = `/tmp/sw-exec-${randomUUID()}.pid`
  const environment = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  const seconds = `${Math.max(0.001, timeoutMs / 1000)}s`
  const execution = await container.exec({ AttachStdout: true, AttachStderr: true, Tty: false, Privileged: false, User: 'worker', WorkingDir: cwd, Env: environment,
    Cmd: ['/usr/bin/env', '-i', ...environment, '/usr/bin/setsid', '--wait', '/bin/sh', '-c', 'echo $$ > "$1"; shift; duration=$1; shift; exec /usr/bin/timeout -k 0.1s "$duration" "$@"', 'sh', marker, seconds, ...args] })
  const stream = await execution.start({ hijack: true, stdin: false })
  const stdout = new PassThrough(), stderr = new PassThrough()
  let out: Buffer = Buffer.alloc(0), err: Buffer = Buffer.alloc(0), timedOut = false, overflowed = false
  stdout.on('data', (chunk: Buffer) => { const next = append(out, chunk, stdoutLimit); out = next.value; overflowed ||= next.overflowed })
  stderr.on('data', (chunk: Buffer) => { err = append(err, chunk, TEXT_LIMIT).value })
  container.modem.demuxStream(stream, stdout, stderr)
  const kill = async () => {
    const cleanup = await container.exec({ Cmd: ['/bin/sh', '-c', 'if test -f "$1"; then /bin/kill -KILL -- -$(cat "$1") 2>/dev/null; rm -f "$1"; fi', 'sh', marker], User: 'worker' })
    await cleanup.start({ Detach: true })
  }
  let abort: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { timedOut = true; void kill().catch(() => undefined); stream.destroy(); resolve() }
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, timeoutMs + 250)
      if (signal?.aborted) abort()
      stream.once('end', () => { clearTimeout(timer); resolve() })
      stream.once('close', () => { clearTimeout(timer); resolve() })
      stream.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    const result = await execution.inspect()
    return { stdout: out, stderr: err, timedOut, overflowed, code: timedOut || result.ExitCode === 137 ? 124 : result.ExitCode ?? 1 }
  } finally { if (abort) signal?.removeEventListener('abort', abort); await kill().catch(() => undefined) }
}

export async function execDocker(container: Docker.Container, command: string, cwd: string, env: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<ExecResult> {
  const result = await runDockerExec(container, ['/bin/sh', '-c', command], cwd, env, timeoutMs, TEXT_LIMIT, signal)
  return { stdout: capOutput(result.stdout.toString()), stderr: capOutput(`${result.stderr.toString()}${result.timedOut ? '\nTerminated: timeout' : ''}`), code: result.code }
}

export async function execBinary(container: Docker.Container, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  if (!args.length) throw new Error('Docker binary command is required')
  const result = await runDockerExec(container, args, cwd, env, timeoutMs, BINARY_LIMIT, signal)
  if (result.timedOut) throw new Error('Docker binary command timed out')
  if (result.overflowed) throw new Error(`Docker binary output exceeded ${BINARY_LIMIT} bytes`)
  if (result.code !== 0) throw new Error(`Docker binary command failed with exit code ${result.code}${result.stderr.length ? `: ${capOutput(result.stderr.toString())}` : ''}`)
  return result.stdout
}
