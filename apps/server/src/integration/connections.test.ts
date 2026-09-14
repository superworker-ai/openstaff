import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import { startServer } from '../app.js'
import { approvals, turns } from '../db/schema.js'
import type { ComposioClient } from '../composio/client.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'

it.each(['request_connection'])('%s gates an unconnected toolkit and the verified callback resumes exactly once with fresh credentials', async (toolName) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'connections-'))
  let active = false
  const client: ComposioClient = {
    connections: vi.fn(async () => [{ id: 'account', toolkit: 'gmail', status: active ? 'ACTIVE' : 'INITIATED', createdAt: new Date().toISOString() }]),
    search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: 'Read Gmail' }),
    execute: vi.fn(async () => ({ inbox: 'Hello' })), link: vi.fn(async () => ({ redirectUrl: 'https://example.com/signin' })),
    toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: 'Read Gmail' }],
  }
  const model = new MockLanguageModelV3({ doStream: [mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'mail', toolName, input: JSON.stringify(toolName === 'request_connection' ? { app: 'Gmail' } : { slug: 'GMAIL_GET_EMAILS', arguments: {} }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]), textStream('Connected and ready.') ] })
  const api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '' }, composioClient: client, modelResolver: () => model })
  let cookie = ''
  const request = (route: string, body?: unknown) => fetch(`${api.url}/api${route}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' })
  try {
    const signup = await request('/auth/signup', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
    cookie = signup.headers.get('set-cookie')!.split(';')[0]!
    const { room } = await (await request('/bots', { name: 'Mail bot', job: 'Mail', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' })).json() as { room: { id: string } }
    expect((await request(`/rooms/${room.id}/messages`, { text: 'Read Gmail', clientRequestId: 'connect-test' })).status).toBe(201)
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns))[0]?.status).toBe('waiting_approval'))
    const approval = (await api.database.db.select().from(approvals))[0]!
    expect(approval).toMatchObject({ kind: 'connect', connection: { source: 'composio', toolkit: 'gmail', appName: 'Gmail' } })
    expect(client.execute).not.toHaveBeenCalled()
    expect((await request(`/approvals/${approval.id}`, { decision: 'approve' })).status).toBe(409)
    const start = await request(`/connections/start?approval=${approval.id}`)
    expect(start.headers.get('location')).toBe('https://example.com/signin')
    expect(client.link).toHaveBeenCalledWith('gmail', expect.stringContaining(`approval=${approval.id}`))
    const early = await request(`/connections/callback?approval=${approval.id}`)
    expect(early.headers.get('location')).toContain('error=')
    expect((await api.database.db.select().from(approvals))[0]?.status).toBe('pending')
    active = true
    expect(await (await request(`/connections/callback?approval=${approval.id}`)).text()).toContain('openstaff:connected')
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns))[0]?.status).toBe('done'))
    expect((await api.database.db.select().from(approvals))[0]?.status).toBe('approved')
    expect(client.execute).not.toHaveBeenCalled()
    expect((await request(`/connections/callback?approval=${approval.id}`)).status).toBe(404)
  } finally { await api.stop(); await fs.rm(directory, { recursive: true, force: true }) }
})
