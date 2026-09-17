import type { Context } from 'hono'
import { expect, it } from 'vitest'
import { publicOrigin } from './helpers.js'

const context = (url: string, headers: Record<string, string> = {}) => ({ req: { url, header: (name: string) => headers[name] } }) as unknown as Context
const requestUrl = 'http://10.0.0.7:8787/api/connections/callback'

it('prefers the configured public app URL', () => {
  expect(publicOrigin(context(requestUrl, { 'x-forwarded-host': 'proxy.example.com' }), { publicAppUrl: 'https://staff.example.com' })).toBe('https://staff.example.com')
})

it('falls back to the forwarded host and protocol, taking the first value of each', () => {
  expect(publicOrigin(context(requestUrl, { 'x-forwarded-host': 'staff.example.com, internal', 'x-forwarded-proto': 'https, http' }), {})).toBe('https://staff.example.com')
  expect(publicOrigin(context(requestUrl, { 'x-forwarded-host': 'staff.example.com' }), {})).toBe('http://staff.example.com')
})

it('falls back to the request URL without forwarded headers', () => {
  expect(publicOrigin(context(requestUrl), {})).toBe(requestUrl)
  expect(publicOrigin(context(requestUrl), { publicAppUrl: '' })).toBe(requestUrl)
})
