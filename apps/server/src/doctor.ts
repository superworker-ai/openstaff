import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { COMPUTER_PROVIDERS, type ComputerProviderId } from '@openstaff/shared'
import { dockerClient } from './computer/docker.js'
import { desktopPasswords } from './computer/desktop-secrets.js'
import { readConfig } from './config.js'
import { resolveDatabasePath } from './db/paths.js'
import { createWorkspaceStore, workspaceStoreInfo } from './storage/index.js'

type Result = { name: string; ok: boolean; hard: boolean; detail: string }
const modelEnvironment = ['XAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY']
const credentials: Record<ComputerProviderId, string[]> = { local: [], docker: [], e2b: ['E2B_API_KEY'], daytona: ['DAYTONA_API_KEY'], freestyle: ['FREESTYLE_API_KEY'], vercel: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'] }
function selected(value: string | undefined): ComputerProviderId { return COMPUTER_PROVIDERS.includes(value as ComputerProviderId) ? value as ComputerProviderId : 'local' }

export async function runDoctor(): Promise<{ ok: boolean; results: Result[] }> {
  const config = readConfig(), production = process.env.NODE_ENV === 'production', results: Result[] = []
  try { await fs.mkdir(config.dataDir, { recursive: true }); await fs.access(config.dataDir, fs.constants.W_OK); results.push({ name: 'DATA_DIR', ok: true, hard: true, detail: 'writable' }) } catch { results.push({ name: 'DATA_DIR', ok: false, hard: true, detail: 'not writable' }) }
  const requestedStore = process.env.WORKSPACE_STORE?.trim() || 'fs', storageHard = production && requestedStore === 's3'
  try {
    const store = createWorkspaceStore(config.dataDir), info = workspaceStoreInfo(store)
    await store.healthy()
    results.push({ name: 'WORKSPACE_STORE', ok: true, hard: storageHard, detail: info.kind === 's3' ? `s3 bucket ${info.bucket}` : 'fs' })
  } catch {
    results.push({ name: 'WORKSPACE_STORE', ok: false, hard: storageHard, detail: requestedStore === 's3' ? `s3 bucket ${process.env.S3_BUCKET?.trim() || 'missing'} unreachable` : 'invalid storage configuration' })
  }
  results.push({ name: 'SECRETS_KEY', ok: !production || Boolean(process.env.SECRETS_KEY), hard: production, detail: process.env.SECRETS_KEY ? 'set' : production ? 'missing' : 'generated-key fallback allowed' })
  const url = process.env.PUBLIC_APP_URL
  results.push({ name: 'PUBLIC_APP_URL', ok: !production || Boolean(url && url.startsWith('https://')), hard: production, detail: url ? production && !url.startsWith('https://') ? 'must use https' : 'set' : 'missing' })
  let settingModels = false, savedCredential = false, migrationCount = 0, expectedMigrations = 0, savedDriver: string | undefined
  let client: ReturnType<typeof createClient> | undefined
  try {
    client = createClient({ url: `file:${resolveDatabasePath(config.dataDir)}` })
    const keys = await client.execute('SELECT provider FROM provider_keys')
    settingModels = keys.rows.length > 0
    const workspace = await client.execute('SELECT computer_driver FROM workspace WHERE id = \'workspace\'')
    savedDriver = typeof workspace.rows[0]?.computer_driver === 'string' ? workspace.rows[0].computer_driver : undefined
    const id = selected(process.env.COMPUTER_DRIVER || savedDriver)
    const stored = await client.execute({ sql: 'SELECT provider FROM computer_credentials WHERE provider = ?', args: [id] })
    savedCredential = stored.rows.length > 0
    const migrations = await client.execute('SELECT count(*) AS count FROM __drizzle_migrations')
    migrationCount = Number(migrations.rows[0]?.count ?? 0)
  } catch { /* A fresh or pre-migration database has no settings tables yet. */ }
  finally { client?.close() }
  const hasModel = settingModels || modelEnvironment.some((name) => Boolean(process.env[name]))
  results.push({ name: 'MODEL_API_KEY', ok: hasModel, hard: production, detail: hasModel ? 'configured' : 'missing' })
  const provider = selected(process.env.COMPUTER_DRIVER || savedDriver)
  const configured = credentials[provider].length === 0 || savedCredential || credentials[provider].every((name) => Boolean(process.env[name]))
  results.push({ name: `${provider.toUpperCase()}_CREDENTIALS`, ok: configured, hard: production, detail: configured ? 'configured' : 'missing' })
  if (provider === 'docker') {
    try { await dockerClient().ping(); results.push({ name: 'DOCKER_HOST', ok: true, hard: true, detail: 'reachable' }) } catch { results.push({ name: 'DOCKER_HOST', ok: false, hard: true, detail: 'unreachable' }) }
    try {
      const password = await desktopPasswords(config.dataDir)
      const authorization = `Basic ${Buffer.from(`viewer:${password.viewer}`).toString('base64')}`
      const response = await fetch(process.env.COMPUTER_DESKTOP_URL ?? 'http://superworkers-computer:6901', { headers: { authorization }, signal: AbortSignal.timeout(2000) })
      await response.body?.cancel()
      results.push({ name: 'COMPUTER_DESKTOP', ok: response.ok, hard: true, detail: response.ok ? 'reachable' : 'unreachable' })
    } catch { results.push({ name: 'COMPUTER_DESKTOP', ok: false, hard: true, detail: 'unreachable' }) }
  }
  try { expectedMigrations = (JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../drizzle/meta/_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length } catch { /* Missing migration metadata is reported as pending. */ }
  results.push({ name: 'SQLITE_MIGRATIONS', ok: migrationCount >= expectedMigrations && expectedMigrations > 0, hard: false, detail: migrationCount >= expectedMigrations && expectedMigrations > 0 ? 'current' : 'pending; startup will apply migrations' })
  return { ok: results.filter((result) => result.hard).every((result) => result.ok), results }
}

if (process.argv[1]?.endsWith('/doctor.ts') || process.argv[1]?.endsWith('/doctor.js')) {
  const result = await runDoctor()
  for (const item of result.results) console.log(`${item.name}: ${item.ok ? 'ok' : item.hard ? 'error' : 'warning'} (${item.detail})`)
  if (!result.ok) process.exitCode = 1
}
