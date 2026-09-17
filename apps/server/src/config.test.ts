import { afterEach, describe, expect, it, vi } from 'vitest'
import { readConfig } from './config.js'

afterEach(() => vi.unstubAllEnvs())

describe('hosted configuration', () => {
  it('is inert by default and accepts explicit overrides', () => {
    vi.stubEnv('WORKSPACE_PLAN', '')
    vi.stubEnv('WORKSPACE_STATE', '')
    expect(readConfig()).toMatchObject({ plan: 'self-hosted', state: 'active', managedKeys: false, composioUserId: 'workspace' })
    expect(readConfig({ plan: 'team', state: 'past_due', managedKeys: true, composioUserId: ' tenant-slug ', billingUrl: 'https://billing.example' })).toMatchObject({ plan: 'team', state: 'past_due', managedKeys: true, composioUserId: 'tenant-slug', billingUrl: 'https://billing.example' })
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

describe('authentication configuration', () => {
  it('closes sign-up to invitations by default and keeps the console mailer', () => {
    vi.stubEnv('SIGNUP_CODE', '')
    vi.stubEnv('AUTH_SIGNUP', '')
    vi.stubEnv('EMAIL_PROVIDER', '')
    expect(readConfig()).toMatchObject({ authSignup: 'invite', email: { provider: 'console' } })
  })

  it('defaults to code sign-up when the legacy code is configured', () => {
    vi.stubEnv('SIGNUP_CODE', 'join-us')
    vi.stubEnv('AUTH_SIGNUP', '')
    expect(readConfig()).toMatchObject({ authSignup: 'code', signupCode: 'join-us' })
  })

  it.each([['postmark', 'EMAIL_PROVIDER must be one of console, smtp, resend'], ['smtp', 'EMAIL_FROM is required when EMAIL_PROVIDER is not console']])('rejects invalid email configuration for %s', (provider, message) => {
    vi.stubEnv('EMAIL_PROVIDER', provider)
    vi.stubEnv('EMAIL_FROM', '')
    expect(() => readConfig()).toThrow(message)
  })

  it('merges the public URL and additional trusted origins', () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://staff.example')
    vi.stubEnv('AUTH_TRUSTED_ORIGINS', 'https://admin.example, https://staff.example')
    expect(readConfig().trustedOrigins).toEqual(['https://staff.example', 'https://admin.example'])
  })

  it('trusts the local web and server ports when no public URL is set outside production', () => {
    vi.stubEnv('PUBLIC_APP_URL', '')
    vi.stubEnv('AUTH_TRUSTED_ORIGINS', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SERVER_PORT', '9911')
    expect(readConfig().trustedOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:9911', 'http://127.0.0.1:9911'])
    vi.stubEnv('NODE_ENV', 'production')
    expect(readConfig().trustedOrigins).toEqual([])
  })
})
