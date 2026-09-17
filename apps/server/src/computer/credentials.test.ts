import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { Secrets } from '../secrets.js'
import { ComputerCredentials, ManagedCredentialsError } from './credentials.js'

it('prefers encrypted workspace Computer credentials over environment values', async () => {
  const f = await fixture()
  try {
    vi.stubEnv('E2B_API_KEY', 'environment-canary')
    const credentials = new ComputerCredentials(f.db, await Secrets.open(f.directory))
    expect((await credentials.resolve('e2b')).values.apiKey).toBe('environment-canary')
    await credentials.set('e2b', { apiKey: 'settings-canary' })
    const resolved = await credentials.resolve('e2b')
    expect(resolved).toEqual({ values: { apiKey: 'settings-canary' }, source: 'settings' })
    expect(JSON.stringify(await f.db.query.computerCredentials.findMany())).not.toContain('settings-canary')
  } finally { vi.unstubAllEnvs(); await f.close() }
})

it('uses only environment Computer credentials in managed mode and rejects writes', async () => {
  const f = await fixture()
  try {
    vi.stubEnv('E2B_API_KEY', 'managed-environment')
    const secrets = await Secrets.open(f.directory), stored = new ComputerCredentials(f.db, secrets)
    await stored.set('e2b', { apiKey: 'saved-canary' })
    const managed = new ComputerCredentials(f.db, secrets, true)
    expect(await managed.resolve('e2b')).toEqual({ values: { apiKey: 'managed-environment' }, source: 'env' })
    await expect(managed.set('e2b', { apiKey: 'replacement' })).rejects.toBeInstanceOf(ManagedCredentialsError)
    await expect(managed.clear('e2b')).rejects.toBeInstanceOf(ManagedCredentialsError)
    vi.stubEnv('E2B_API_KEY', '')
    expect(await managed.resolve('e2b')).toEqual({ values: {}, source: null })
  } finally { vi.unstubAllEnvs(); await f.close() }
})
