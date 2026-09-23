import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { connections as connectionRows, messages } from '../db/schema.js'
import { toolApprovalFor } from '../agent/approval-policy.js'
import { ComposioService } from './service.js'
import { ConnectionRequiredError } from '../agent/connections.js'
import type { ComposioClient, ComposioConnection } from './client.js'

const account = (values: Partial<ComposioConnection> & { id: string; toolkit: string }): ComposioConnection =>
  ({ status: 'ACTIVE', createdAt: new Date().toISOString(), userId: 'workspace', ...values })
/** Composio filters by the identities asked for, so `verifyConnection` can only see its own scope. */
const listing = (rows: () => ComposioConnection[]) => async (userIds: string[]) => rows().filter((row) => userIds.includes(row.userId))

it('filters connected tools, caches accounts, applies approval policy and posts connection links', async () => {
  const f = await fixture()
  const client: ComposioClient = {
    connections: vi.fn(async () => [account({ id: 'connection-1', toolkit: 'github' })]),
    search: vi.fn(async (query: string) => query === 'nothing here' ? [] : [{ slug: 'GITHUB_GET_REPOS', toolkit: 'github', description: 'Read repositories', inputParameters: { type: 'object', properties: {} } }, { slug: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', description: 'Send mail' }]),
    metadata: async (slug) => ({ slug, toolkit: 'github', description: '', version: '20260101_00' }),
    execute: vi.fn(async () => ({ successful: true })), link: async () => ({ redirectUrl: 'https://example.com/connect' }), toolkits: async () => [],
  }
  const service = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, client)
  try {
    expect(await service.search('repo', f.userId)).toMatchObject({ tools: [{ slug: 'GITHUB_GET_REPOS', connected: true, inputParameters: { type: 'object' } }], connectedApps: ['github'] })
    expect(client.search).toHaveBeenCalledWith('repo', ['github'])
    expect((await service.search('mail', f.userId, { includeUnconnected: true })).tools).toHaveLength(2)
    // A toolkit filter narrows the provider query; an unconnected one or an empty match explains itself instead of returning [].
    expect(await service.search('repo', f.userId, { toolkit: 'GitHub' })).toMatchObject({ tools: [{ slug: 'GITHUB_GET_REPOS' }] })
    expect(client.search).toHaveBeenLastCalledWith('repo', ['github'])
    expect(await service.search('mail', f.userId, { toolkit: 'Gmail' })).toMatchObject({ tools: [], note: expect.stringContaining('Gmail is not connected') })
    expect(await service.search('nothing here', f.userId)).toMatchObject({ tools: [], note: expect.stringContaining('No tool matched "nothing here" in github') })
    expect(client.connections).toHaveBeenCalledOnce()
    expect(client.connections).toHaveBeenCalledWith(['workspace', `workspace:${f.userId}`])
    const gate = toolApprovalFor('writes', new Set(), (slug) => service.isReadOnly(slug))
    expect(await gate({ toolCall: { toolName: 'composio_execute', input: { slug: 'GITHUB_CREATE_ISSUE' } } })).toBe('user-approval')
    expect(client.execute).not.toHaveBeenCalled()
    expect(await gate({ toolCall: { toolName: 'composio_execute', input: { slug: 'GITHUB_GET_REPOS' } } })).toBeUndefined()
    expect(await toolApprovalFor('all')({ toolCall: { toolName: 'composio_search' } })).toBe('user-approval')
    expect(await toolApprovalFor('auto')({ toolCall: { toolName: 'composio_execute' } })).toBeUndefined()
    expect(await toolApprovalFor('writes', new Set(['p__read']))({ toolCall: { toolName: 'p__read' } })).toBeUndefined()
    expect(await toolApprovalFor('writes')({ toolCall: { toolName: 'p__write' } })).toBe('user-approval')
    await service.execute('GITHUB_GET_REPOS', {}, f.userId)
    expect(client.execute).toHaveBeenCalledWith('GITHUB_GET_REPOS', {}, expect.objectContaining({ userId: 'workspace', connectedAccountId: 'connection-1' }))
    await service.link('gmail', { scope: 'member', userId: f.userId }, f.roomId)
    expect(await f.db.select().from(messages)).toMatchObject([{ authorKind: 'system', text: 'Connect gmail: https://example.com/connect' }])
  } finally { await f.close() }
})

it('prefers a personal account, falls back to the workspace one, and shows a null actor only the workspace account', async () => {
  const f = await fixture()
  const mine = `workspace:${f.userId}`
  let personal = 'ACTIVE'
  const client: ComposioClient = {
    connections: listing(() => [account({ id: 'shared', toolkit: 'gmail' }), account({ id: 'personal', toolkit: 'gmail', userId: mine, status: personal })]),
    search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), execute: vi.fn(async () => ({ successful: true })),
    link: vi.fn(async () => ({ redirectUrl: 'https://example.com' })), toolkits: async () => [],
  }
  const service = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, client)
  try {
    expect((await service.resolve('gmail', f.userId))?.id).toBe('personal')
    expect((await service.resolve('gmail', 'user_other', true))?.id).toBe('shared')
    expect((await service.resolve('gmail', null, true))?.id).toBe('shared')
    await service.execute('GMAIL_GET_EMAILS', {}, f.userId)
    expect(client.execute).toHaveBeenCalledWith('GMAIL_GET_EMAILS', {}, expect.objectContaining({ userId: mine, connectedAccountId: 'personal' }))
    personal = 'INITIATED'
    expect((await service.resolve('gmail', f.userId, true))?.id).toBe('shared')
    // The mirror keeps the owning identity so the HTTP layer can authorize a disconnect.
    expect(await f.db.select({ id: connectionRows.composioConnectedAccountId, scope: connectionRows.scope, userId: connectionRows.userId }).from(connectionRows)).toEqual(expect.arrayContaining([
      { id: 'shared', scope: 'workspace', userId: null }, { id: 'personal', scope: 'member', userId: f.userId },
    ]))
    await service.link('gmail', { scope: 'member', userId: f.userId })
    expect(client.link).toHaveBeenCalledWith('gmail', mine, undefined)
    await service.link('gmail', { scope: 'workspace' })
    expect(client.link).toHaveBeenLastCalledWith('gmail', 'workspace', undefined)
  } finally { await f.close() }
})

it.each([new Error('HTTP 401: connection expired'), { successful: false, error: 'Account not connected' }])('execution auth failure expires only the failing account: %j', async (failure) => {
  const f = await fixture()
  const mine = `workspace:${f.userId}`
  let active = true, failing = true
  const client: ComposioClient = {
    connections: listing(() => [account({ id: 'shared', toolkit: 'gmail' }), account({ id: 'personal', toolkit: 'gmail', userId: mine, status: active ? 'ACTIVE' : 'INITIATED' })]),
    metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), search: async () => [], toolkits: async () => [], link: async () => ({ redirectUrl: 'https://example.com' }),
    execute: vi.fn(async (_slug, _args, options) => { if (failing && options.connectedAccountId === 'personal') { if (failure instanceof Error) throw failure; return failure } return { successful: true } }),
  }
  const service = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, client)
  try {
    await expect(service.execute('GMAIL_GET_EMAILS', {}, f.userId)).rejects.toBeInstanceOf(ConnectionRequiredError)
    const rows = await service.listConnections(true)
    expect(rows.find((row) => row.id === 'personal')?.status).toBe('EXPIRED')
    expect(rows.find((row) => row.id === 'shared')?.status).toBe('ACTIVE')
    // The workspace account is still usable, so the expired personal one no longer resolves.
    expect((await service.resolve('gmail', f.userId, true))?.id).toBe('shared')
    active = false
    await expect(service.verifyConnection('gmail', 'member', f.userId)).rejects.toThrow('not active')
    active = true; failing = false
    await service.verifyConnection('gmail', 'member', f.userId)
    expect((await service.resolve('gmail', f.userId, true))?.id).toBe('personal')
    expect(await service.execute('GMAIL_GET_EMAILS', {}, f.userId)).toEqual({ successful: true })
  } finally { await f.close() }
})
