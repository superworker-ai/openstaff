import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { messages } from '../db/schema.js'
import { toolApprovalFor } from '../agent/approval-policy.js'
import { ComposioService } from './service.js'
import { ConnectionRequiredError } from '../agent/connections.js'
import type { ComposioClient } from './client.js'

it('filters connected tools, caches accounts, applies approval policy and posts connection links', async () => {
  const f = await fixture()
  const client: ComposioClient = {
    connections: vi.fn(async () => [{ id: 'connection-1', toolkit: 'github', status: 'ACTIVE', createdAt: new Date().toISOString() }]),
    search: vi.fn(async () => [{ slug: 'GITHUB_GET_REPOS', toolkit: 'github', description: 'Read repositories' }, { slug: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', description: 'Send mail' }]),
    metadata: async (slug) => ({ slug, toolkit: 'github', description: '', version: '20260101_00' }),
    execute: vi.fn(async () => ({ successful: true })), link: async () => ({ redirectUrl: 'https://example.com/connect' }), toolkits: async () => [],
  }
  const service = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, client)
  try {
    expect(await service.search('repo')).toMatchObject([{ slug: 'GITHUB_GET_REPOS', connected: true }])
    expect(client.search).toHaveBeenCalledWith('repo', ['github'])
    expect(await service.search('mail', true)).toHaveLength(2)
    expect(client.connections).toHaveBeenCalledOnce()
    const gate = toolApprovalFor('writes', new Set(), (slug) => service.isReadOnly(slug))
    expect(await gate({ toolCall: { toolName: 'composio_execute', input: { slug: 'GITHUB_CREATE_ISSUE' } } })).toBe('user-approval')
    expect(client.execute).not.toHaveBeenCalled()
    expect(await gate({ toolCall: { toolName: 'composio_execute', input: { slug: 'GITHUB_GET_REPOS' } } })).toBeUndefined()
    expect(await toolApprovalFor('all')({ toolCall: { toolName: 'composio_search' } })).toBe('user-approval')
    expect(await toolApprovalFor('auto')({ toolCall: { toolName: 'composio_execute' } })).toBeUndefined()
    expect(await toolApprovalFor('writes', new Set(['p__read']))({ toolCall: { toolName: 'p__read' } })).toBeUndefined()
    expect(await toolApprovalFor('writes')({ toolCall: { toolName: 'p__write' } })).toBe('user-approval')
    await service.execute('GITHUB_GET_REPOS', {})
    expect(client.execute).toHaveBeenCalledOnce()
    await service.link('gmail', f.roomId)
    expect(await f.db.select().from(messages)).toMatchObject([{ authorKind: 'system', text: 'Connect gmail: https://example.com/connect' }])
  } finally { await f.close() }
})

it.each([new Error('HTTP 401: connection expired'), { successful: false, error: 'Account not connected' }])('execution auth failure stays expired until a verified reconnect: %j', async (failure) => {
  const f = await fixture()
  let active = true, failing = true
  const client: ComposioClient = {
    connections: async () => [{ id: 'account', toolkit: 'gmail', status: active ? 'ACTIVE' : 'INITIATED', createdAt: new Date().toISOString() }],
    metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), search: async () => [], toolkits: async () => [], link: async () => ({ redirectUrl: 'https://example.com' }),
    execute: vi.fn(async () => { if (failing) { if (failure instanceof Error) throw failure; return failure } return { successful: true } }),
  }
  const service = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, client)
  try {
    await expect(service.execute('GMAIL_GET_EMAILS', {})).rejects.toBeInstanceOf(ConnectionRequiredError)
    expect(await service.connected('gmail', true)).toBe(false)
    expect((await service.listConnections())[0]?.status).toBe('EXPIRED')
    active = false
    await expect(service.verifyConnection('gmail')).rejects.toThrow('not active')
    active = true; failing = false
    await service.verifyConnection('gmail')
    expect(await service.connected('gmail', true)).toBe(true)
    expect(await service.execute('GMAIL_GET_EMAILS', {})).toEqual({ successful: true })
    expect(client.execute).toHaveBeenCalledTimes(2)
  } finally { await f.close() }
})
