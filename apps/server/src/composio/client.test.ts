import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  authConfigs: { list: vi.fn(), create: vi.fn(async () => ({ id: 'ac_new', authScheme: 'X', isComposioManaged: false, toolkit: 't' })) },
  toolkits: { get: vi.fn() },
  tools: { execute: vi.fn(async () => ({ successful: true })) },
  connectedAccounts: { link: vi.fn(async () => ({ id: 'ca_1', status: 'INITIATED', redirectUrl: 'https://connect.example/link' })), delete: vi.fn() },
  // The owning user id only survives on the raw typed client, so accounts are listed through it.
  client: { connectedAccounts: { list: vi.fn(async () => ({ items: [{ id: 'ca_1', toolkit: { slug: 'gmail' }, status: 'ACTIVE', is_disabled: false, created_at: '2026-01-01T00:00:00.000Z', user_id: 'workspace:user_1' }], next_cursor: null })) } },
}))
vi.mock('@composio/core', () => ({ Composio: class { constructor() { Object.assign(this, sdk) } } }))

import { createComposioClient } from './client.js'

beforeEach(() => { vi.clearAllMocks(); sdk.authConfigs.list.mockResolvedValue({ items: [] }) })

it('forwards every requested identity and executes against one connected account', async () => {
  const client = createComposioClient('api-key', '/tmp/composio-test')
  sdk.authConfigs.list.mockResolvedValue({ items: [{ id: 'auth-config' }] })
  expect(await client.connections(['workspace', 'workspace:user_1'])).toEqual([{ id: 'ca_1', toolkit: 'gmail', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', userId: 'workspace:user_1' }])
  await client.execute('GITHUB_GET_REPOS', {}, { userId: 'workspace:user_1', connectedAccountId: 'ca_1', version: '20260101_00' })
  await client.link('github', 'workspace:user_1')
  expect(sdk.client.connectedAccounts.list).toHaveBeenCalledWith(expect.objectContaining({ user_ids: ['workspace', 'workspace:user_1'] }), expect.anything())
  expect(sdk.tools.execute).toHaveBeenCalledWith('GITHUB_GET_REPOS', expect.objectContaining({ userId: 'workspace:user_1', connectedAccountId: 'ca_1', version: '20260101_00' }), expect.anything())
  expect(sdk.connectedAccounts.link).toHaveBeenCalledWith('workspace:user_1', 'auth-config', { callbackUrl: undefined }, expect.anything())
})

describe('createComposioClient.link', () => {
  const client = createComposioClient('key', '/tmp/composio-client-test')

  it('reuses an existing auth config without asking Composio about the toolkit', async () => {
    sdk.authConfigs.list.mockResolvedValue({ items: [{ id: 'ac_existing' }] })
    await expect(client.link('gmail', 'workspace', 'https://app/callback')).resolves.toEqual({ redirectUrl: 'https://connect.example/link' })
    expect(sdk.toolkits.get).not.toHaveBeenCalled()
    expect(sdk.authConfigs.create).not.toHaveBeenCalled()
    expect(sdk.connectedAccounts.link).toHaveBeenCalledWith('workspace', 'ac_existing', { callbackUrl: 'https://app/callback' }, expect.anything())
  })

  it('creates a Composio-managed auth config when the toolkit offers one', async () => {
    sdk.toolkits.get.mockResolvedValue({ name: 'Gmail', composioManagedAuthSchemes: ['OAUTH2'], authConfigDetails: [{ mode: 'OAUTH2' }] })
    await client.link('gmail', 'workspace')
    expect(sdk.authConfigs.create).toHaveBeenCalledWith('gmail', { type: 'use_composio_managed_auth' }, expect.anything())
    expect(sdk.connectedAccounts.link).toHaveBeenCalledWith('workspace', 'ac_new', { callbackUrl: undefined }, expect.anything())
  })

  it('falls back to a workspace-owned API key config so the hosted page can collect the key', async () => {
    sdk.toolkits.get.mockResolvedValue({ name: '1Password', composioManagedAuthSchemes: [], authConfigDetails: [{ mode: 'API_KEY' }] })
    await client.link('_1password', 'workspace')
    expect(sdk.authConfigs.create).toHaveBeenCalledWith('_1password', { type: 'use_custom_auth', authScheme: 'API_KEY', credentials: {} }, expect.anything())
  })

  it('prefers a non-OAuth scheme when only custom schemes exist', async () => {
    sdk.toolkits.get.mockResolvedValue({ name: 'Acme', composioManagedAuthSchemes: [], authConfigDetails: [{ mode: 'OAUTH2' }, { mode: 'BEARER_TOKEN' }] })
    await client.link('acme', 'workspace')
    expect(sdk.authConfigs.create).toHaveBeenCalledWith('acme', { type: 'use_custom_auth', authScheme: 'BEARER_TOKEN', credentials: {} }, expect.anything())
  })

  it('explains what to do when only a custom OAuth client would work', async () => {
    sdk.toolkits.get.mockResolvedValue({ name: 'Acme', composioManagedAuthSchemes: [], authConfigDetails: [{ mode: 'OAUTH2' }] })
    await expect(client.link('acme', 'workspace')).rejects.toThrow(/Acme needs your own OAuth client/)
    expect(sdk.authConfigs.create).not.toHaveBeenCalled()
    expect(sdk.connectedAccounts.link).not.toHaveBeenCalled()
  })
})
