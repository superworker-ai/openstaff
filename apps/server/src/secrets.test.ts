import { expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { fixture } from './test/fixture.js'
import { KeyStore, Secrets } from './secrets.js'
import { providerKeys } from './db/schema.js'

it('authenticates encrypted values, persists keys, and falls back to environment on clear', async () => {
  const f = await fixture()
  try {
    vi.stubEnv('XAI_API_KEY', 'environment-value')
    const secrets = await Secrets.open(f.directory)
    const encrypted = secrets.encrypt('canary-provider-secret')
    expect(encrypted).not.toContain('canary-provider-secret')
    expect(secrets.decrypt(encrypted)).toBe('canary-provider-secret')
    const contextual = secrets.encrypt('computer-secret', 'computer:e2b')
    expect(contextual.startsWith('v2.')).toBe(true)
    expect(secrets.decrypt(contextual, 'computer:e2b')).toBe('computer-secret')
    expect(() => secrets.decrypt(contextual, 'computer:daytona')).toThrow()
    expect(() => new Secrets(randomBytes(32)).decrypt(encrypted)).toThrow()
    const keys = new KeyStore(f.db, secrets)
    await keys.set({ xai: 'database-value' })
    expect(keys.get('xai')).toBe('database-value')
    expect(JSON.stringify(await f.db.select().from(providerKeys))).not.toContain('database-value')
    const reopened = new KeyStore(f.db, await Secrets.open(f.directory))
    await reopened.load()
    expect(reopened.get('xai')).toBe('database-value')
    expect(reopened.configured().xai).toBe(true)
    await reopened.set({ xai: '' })
    expect(reopened.get('xai')).toBe('environment-value')
  } finally { vi.unstubAllEnvs(); await f.close() }
})
