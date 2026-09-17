import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type BrowserContext } from 'playwright'
import { MockLanguageModelV3 } from 'ai/test'
import { startServer, type RunningServer } from '../app.js'
import { botTemplates } from '../api/bots.js'
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

export type BrowserHarness = Awaited<ReturnType<typeof browserHarness>>

export const BROWSER_PASSWORD = 'browser-password123'

/**
 * Signs up through the Better Auth signup page and waits for the empty-workspace
 * agent builder. Every browser suite starts here so the real form stays covered.
 */
export async function signUp(h: BrowserHarness, options: { name?: string; email?: string; password?: string } = {}): Promise<{ name: string; email: string; password: string }> {
  const name = options.name ?? 'Browser Owner'
  const email = options.email ?? `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`
  const password = options.password ?? BROWSER_PASSWORD
  await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
  await h.page.locator('body[data-hydrated="true"]').waitFor()
  // An empty workspace advertises the bootstrap copy; a seeded one the plain link.
  await h.page.getByRole('link', { name: /^Create (account|the first account for this workspace)$/ }).click()
  await h.page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor()
  await h.page.getByPlaceholder('Your name').fill(name)
  await h.page.getByPlaceholder('Email', { exact: true }).fill(email)
  await h.page.getByPlaceholder('Password', { exact: true }).fill(password)
  await h.page.getByRole('button', { name: 'Create account', exact: true }).click()
  // An empty workspace sends the new owner straight to the agent builder.
  await h.page.waitForURL(`${h.url}/bots/new`, { waitUntil: 'domcontentloaded' })
  await h.page.locator('body[data-hydrated="true"]').waitFor()
  return { name, email, password }
}

/**
 * Creates an agent through the current `/bots/new` document builder and returns the
 * path of the room the builder opens. The starting point, the role it fills in, and
 * the default approval policy are all verified on the way through.
 */
export async function createAgent(h: BrowserHarness, name: string, options: { template?: string; role?: string; approvals?: 'auto' | 'writes' | 'all' } = {}): Promise<string> {
  await h.page.waitForURL(`${h.url}/bots/new`, { waitUntil: 'domcontentloaded' })
  await h.page.locator('body[data-hydrated="true"]').waitFor()
  const role = h.page.getByLabel('Role', { exact: true })
  const templateName = options.template ?? botTemplates[0]!.name
  const template = botTemplates.find((item) => item.name === templateName)
  if (!template) throw new Error(`Unknown agent starting point: ${templateName}`)
  if (options.template) await h.page.getByLabel('Starting point', { exact: true }).selectOption({ label: options.template })
  if (options.role !== undefined) await role.fill(options.role)
  else {
    // The starting point owns the role, so the builder must have applied it.
    const filled = await role.inputValue()
    if (filled !== template.job) throw new Error(`Starting point "${templateName}" left the role as "${filled}", expected "${template.job}"`)
  }
  const approvals = h.page.getByLabel('Approvals', { exact: true })
  if (options.approvals) await approvals.selectOption(options.approvals)
  else {
    const policy = await approvals.inputValue()
    if (policy !== 'writes') throw new Error(`Expected the default approval policy to be "writes", got "${policy}"`)
  }
  await h.page.getByRole('textbox', { name: 'Agent name', exact: true }).fill(name)
  await h.page.getByRole('button', { name: 'Create agent', exact: true }).click()
  await h.page.waitForURL(/\/rooms\/room_[^/]+$/, { waitUntil: 'domcontentloaded' })
  return new URL(h.page.url()).pathname
}
