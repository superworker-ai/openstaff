import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type BrowserContext } from 'playwright'
import { MockLanguageModelV3 } from 'ai/test'
import { startServer, type RunningServer } from '../app.js'
import type { ModelResolver } from '../agent/models.js'
import type { ComposioClient } from '../composio/client.js'
import { objectResult, textStream } from './mock-model.js'

async function ephemeralPort(): Promise<number> {
  const reserve = createServer()
  await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve))
  const port = (reserve.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => reserve.close((error) => error ? reject(error) : resolve()))
  return port
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
  try { await exited } finally { clearTimeout(timer) }
}

export async function browserHarness(options: { modelResolver?: ModelResolver; hostname?: string; composioClient?: ComposioClient } = {}) {
  const directory = await fs.mkdtemp(path.resolve('data-test-browser-'))
  let api: RunningServer | undefined, web: ChildProcess | undefined, context: BrowserContext | undefined
  let stopped: Promise<void> | undefined
  const stop = () => stopped ??= (async () => {
    try { await context?.close() }
    finally {
      try { if (web) await stopProcess(web) }
      finally { try { await api?.stop() } finally { await fs.rm(directory, { recursive: true, force: true }) } }
    }
  })()
  try {
    const model = new MockLanguageModelV3({ doGenerate: objectResult({ reply: false, reason: 'Nothing new to add' }), doStream: async () => textStream('Hello from your teammate.') })
    const port = await ephemeralPort(), url = `http://${options.hostname ?? '127.0.0.1'}:${port}`
    api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '', publicAppUrl: url }, modelResolver: options.modelResolver ?? (() => model), composioClient: options.composioClient })
    const webDir = path.resolve(import.meta.dirname, '../../../web')
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['PORT', 'SERVER_PORT', 'HOST', 'NITRO_PORT', 'NITRO_HOST'].includes(key)))
    web = spawn(process.execPath, [path.join(webDir, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', options.hostname ?? '127.0.0.1'], { cwd: webDir, env: { ...env, PUBLIC_API_URL: api.url, DATA_DIR: directory }, stdio: 'pipe' })
    let output = '', spawnError: Error | undefined
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_000) }
    web.stdout?.on('data', capture); web.stderr?.on('data', capture)
    web.on('error', (error) => { spawnError = error })
    const deadline = Date.now() + 30_000
    let ready = false
    while (Date.now() < deadline) {
      if (spawnError || web.exitCode !== null || web.signalCode !== null) throw new Error(`Vite exited before readiness: ${spawnError?.message ?? web.exitCode}\n${output}`)
      try {
        const response = await fetch(`${url}/login`, { signal: AbortSignal.timeout(Math.min(1000, deadline - Date.now())) })
        if (response.ok && (await response.text()).includes('OpenStaff')) { ready = true; break }
      } catch { /* HTTP readiness, not a log-line or fixed startup delay. */ }
      await delay(100)
    }
    if (!ready) throw new Error(`Vite did not become HTTP-ready within 30 seconds at ${url}\n${output}`)
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { headless: true, artifactsDir: path.join(directory, 'artifacts'), viewport: { width: 1440, height: 1000 } })
    // A remote font stylesheet can block DOM readiness; functional tests use system fonts.
    await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
    context.setDefaultTimeout(10_000)
    const page = await context.newPage()
    return { page, context, api, url, stop }
  } catch (error) { await stop(); throw error }
}
