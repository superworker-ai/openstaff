import { afterEach, describe, expect, it, vi } from 'vitest'
import { readConfig } from './config.js'

afterEach(() => vi.unstubAllEnvs())

describe('hosted configuration', () => {
  it('is inert by default and accepts explicit overrides', () => {
    vi.stubEnv('WORKSPACE_PLAN', '')
    vi.stubEnv('WORKSPACE_STATE', '')
    expect(readConfig()).toMatchObject({ plan: 'self-hosted', state: 'active', managedKeys: false })
    expect(readConfig({ plan: 'team', state: 'past_due', managedKeys: true, billingUrl: 'https://billing.example' })).toMatchObject({ plan: 'team', state: 'past_due', managedKeys: true, billingUrl: 'https://billing.example' })
  })

  it.each([
    ['WORKSPACE_PLAN', 'enterprise', 'self-hosted, starter, team, business'],
    ['WORKSPACE_STATE', 'cancelled', 'active, past_due, suspended'],
  ])('rejects an unknown %s value', (name, value, allowed) => {
    vi.stubEnv(name, value)
    expect(() => readConfig()).toThrow(`${name} must be one of ${allowed}`)
  })

  it('rejects the local environment driver on hosted plans', () => {
    vi.stubEnv('COMPUTER_DRIVER', 'local')
    expect(() => readConfig({ plan: 'starter' })).toThrow('COMPUTER_DRIVER=local is not allowed on hosted plans')
  })
})
