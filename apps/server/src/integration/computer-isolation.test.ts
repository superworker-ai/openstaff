import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createApplication } from '../app.js'
import { dockerProvider } from '../computer/docker-provider.js'
import { e2bProvider } from '../computer/e2b.js'
import { daytonaProvider } from '../computer/daytona.js'
import { freestyleProvider } from '../computer/freestyle.js'
import { vercelProvider } from '../computer/vercel.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it.each(['docker', 'e2b', 'daytona', 'freestyle', 'vercel'])('uses a fake application Computer despite inherited COMPUTER_DRIVER=%s', async (driver) => {
  vi.stubEnv('COMPUTER_DRIVER', driver)
  vi.stubEnv('E2B_API_KEY', 'isolation-canary')
  vi.stubEnv('DAYTONA_API_KEY', 'isolation-canary')
  vi.stubEnv('FREESTYLE_API_KEY', 'isolation-canary')
  vi.stubEnv('FREESTYLE_BASE_URL', 'https://isolation.invalid')
  vi.stubEnv('VERCEL_TOKEN', 'isolation-canary')
  vi.stubEnv('VERCEL_TEAM_ID', 'team_isolation')
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_isolation')
  const opens = [dockerProvider, e2bProvider, daytonaProvider, freestyleProvider, vercelProvider].map((provider) => vi.spyOn(provider, 'open').mockRejectedValue(new Error('Real provider must never open in application fixtures')))
  const directory = await fs.mkdtemp(path.resolve('data-test-isolation-'))
  const application = await createApplication({ config: { dataDir: directory } })
  try {
    const computer = application.dependencies.computer
    expect(await computer.status()).toMatchObject({ detail: 'Test-only fake computer', status: 'ready' })
    expect((await computer.exec('printf fake')).stdout).toBe('fake')
    const health = await application.app.request('/api/health')
    expect(health.status).toBe(200)
    const healthBody = await health.json()
    expect(healthBody).toMatchObject({ storage: { kind: 'fs', healthy: true } })
    expect(JSON.stringify(healthBody)).not.toContain('isolation-canary')
    for (const open of opens) expect(open).not.toHaveBeenCalled()
  } finally { await application.close(); await fs.rm(directory, { recursive: true, force: true }) }
})
