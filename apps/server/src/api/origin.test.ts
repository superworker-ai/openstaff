import { afterEach, expect, it, vi } from 'vitest'
import { originAllowed } from './origin.js'

afterEach(() => vi.unstubAllEnvs())

const base = { requestUrl: 'http://127.0.0.1:8787/api/computer/desktop/assets/ui.css' }

it('allows requests without an Origin header (plain navigations)', () => {
  expect(originAllowed(undefined, { ...base, headers: { host: '127.0.0.1:8787' } })).toBe(true)
})

it('accepts the configured public app origin and rejects others', () => {
  const input = { ...base, publicAppUrl: 'https://staff.example.com', headers: { host: 'internal:8787' } }
  expect(originAllowed('https://staff.example.com', input)).toBe(true)
  expect(originAllowed('https://evil.example.com', input)).toBe(false)
})

it('honours forwarded host and protocol from a reverse proxy', () => {
  const headers = { host: 'server:8787', 'x-forwarded-host': 'staff.example.com', 'x-forwarded-proto': 'https' }
  expect(originAllowed('https://staff.example.com', { ...base, headers })).toBe(true)
  expect(originAllowed('http://staff.example.com', { ...base, headers })).toBe(false)
})

it('accepts the Vite dev origin on another loopback port outside production', () => {
  vi.stubEnv('NODE_ENV', 'development')
  expect(originAllowed('http://localhost:3000', { ...base, headers: { host: '127.0.0.1:8787' } })).toBe(true)
  expect(originAllowed('http://evil.example.com', { ...base, headers: { host: '127.0.0.1:8787' } })).toBe(false)
})

it('does not relax loopback origins in production', () => {
  vi.stubEnv('NODE_ENV', 'production')
  expect(originAllowed('http://localhost:3000', { ...base, headers: { host: '127.0.0.1:8787' } })).toBe(false)
})

it('works with Fetch Headers objects', () => {
  const headers = new Headers({ host: 'app.example.test' })
  expect(originAllowed('http://app.example.test', { ...base, requestUrl: 'http://app.example.test/api/x', headers })).toBe(true)
})
