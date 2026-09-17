import { beforeEach, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  connections: vi.fn(async () => ({ items: [], nextCursor: null })),
  execute: vi.fn(async () => ({ successful: true })),
  authConfigs: vi.fn(async () => ({ items: [{ id: 'auth-config' }] })),
  link: vi.fn(async () => ({ redirectUrl: 'https://example.test/connect' })),
}))

vi.mock('@composio/core', () => ({
  Composio: class {
    connectedAccounts = { list: sdk.connections, link: sdk.link, delete: vi.fn() }
    tools = { execute: sdk.execute }
    authConfigs = { list: sdk.authConfigs, create: vi.fn() }
  },
}))

import { createComposioClient } from './client.js'

beforeEach(() => vi.clearAllMocks())

it('uses the configured user id for Composio account operations', async () => {
  const client = createComposioClient('api-key', '/tmp/composio-test', 'tenant-slug')
  await client.connections()
  await client.execute('GITHUB_GET_REPOS', {})
  await client.link('github')
  expect(sdk.connections).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['tenant-slug'] }), expect.anything())
  expect(sdk.execute).toHaveBeenCalledWith('GITHUB_GET_REPOS', expect.objectContaining({ userId: 'tenant-slug' }), expect.anything())
  expect(sdk.link).toHaveBeenCalledWith('tenant-slug', 'auth-config', { callbackUrl: undefined }, expect.anything())
})
