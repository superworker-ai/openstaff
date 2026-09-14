import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { Secrets } from '../secrets.js'
import { ComputerCredentials } from './credentials.js'

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
