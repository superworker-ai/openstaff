import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import { startServer } from '../app.js'
import { approvals, turns, users } from '../db/schema.js'
import type { ComposioClient, ComposioConnection } from '../composio/client.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { signedIn } from '../test/auth.js'

const connectRequest = (toolCallId: string) => mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId, toolName: 'request_connection', input: '{"app":"Gmail"}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])

it.each(['request_connection'])('%s gates an unconnected toolkit and the verified callback resumes exactly once with fresh credentials', async (toolName) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'connections-'))
  let active = false, loseRace = false
  let accounts: ComposioConnection[] = []
  const client: ComposioClient = {
    // `loseRace` reproduces Composio redirecting to the callback a beat before the account flips to ACTIVE.
    connections: vi.fn(async (userIds) => { const status = active && !loseRace ? 'ACTIVE' : 'INITIATED'; loseRace = false; return accounts.filter((row) => userIds.includes(row.userId)).map((row) => ({ ...row, status })) }),
    search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: 'Read Gmail' }),
    execute: vi.fn(async () => ({ inbox: 'Hello' })), link: vi.fn(async () => ({ redirectUrl: 'https://example.com/signin' })),
    disconnect: vi.fn(async (id: string) => { accounts = accounts.filter((row) => row.id !== id); return {} }),
    toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: 'Read Gmail' }],
  }
  const model = new MockLanguageModelV3({ doStream: [mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'mail', toolName, input: JSON.stringify(toolName === 'request_connection' ? { app: 'Gmail' } : { slug: 'GMAIL_GET_EMAILS', arguments: {} }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]), textStream('Connected and ready.') ] })
  const api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '' }, composioClient: client, modelResolver: () => model })
  let cookie = ''
  const request = (route: string, body?: unknown) => fetch(`${api.url}/api${route}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' })
  try {
    const signup = await request('/auth/sign-up/email', { name: 'Owner', email: 'owner@example.com', password: 'password123' })
    cookie = signup.headers.get('set-cookie')!.split(';')[0]!
    const owner = (await api.database.db.select({ id: users.id }).from(users).limit(1))[0]!
    // A stale INITIATED account of the same identity is what `forgetStale` has to clean before linking.
    accounts = [{ id: 'account', toolkit: 'gmail', status: 'INITIATED', createdAt: new Date().toISOString(), userId: `workspace:${owner.id}` }]
    const { room } = await (await request('/bots', { name: 'Mail bot', job: 'Mail', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' })).json() as { room: { id: string } }
    expect((await request(`/rooms/${room.id}/messages`, { text: 'Read Gmail', clientRequestId: 'connect-test' })).status).toBe(201)
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns))[0]?.status).toBe('waiting_approval'))
    const approval = (await api.database.db.select().from(approvals))[0]!
    expect(approval).toMatchObject({ kind: 'connect', connection: { source: 'composio', toolkit: 'gmail', appName: 'Gmail' } })
    expect(client.execute).not.toHaveBeenCalled()
    expect((await request(`/approvals/${approval.id}`, { decision: 'approve' })).status).toBe(409)
    const start = await request(`/connections/start?approval=${approval.id}`)
    expect(start.headers.get('location')).toBe('https://example.com/signin')
    expect(client.link).toHaveBeenCalledWith('gmail', `workspace:${owner.id}`, expect.stringContaining(`approval=${approval.id}`))
    // Linking clears the stale INITIATED account instead of stacking another one beside it.
    expect(client.disconnect).toHaveBeenCalledWith('account')
    accounts = [{ id: 'linked', toolkit: 'gmail', status: 'INITIATED', createdAt: new Date().toISOString(), userId: `workspace:${owner.id}` }]
    const early = await request(`/connections/callback?approval=${approval.id}`)
    expect(early.status).toBe(200)
    expect(early.headers.get('location')).toBeNull()
    const earlyHtml = await early.text()
    expect(earlyHtml).toContain('Could not connect Gmail')
    expect(earlyHtml).toContain('Try again')
    expect(earlyHtml).toContain(`/api/connections/start?toolkit=gmail&amp;approval=${approval.id}`)
    expect((await api.database.db.select().from(approvals))[0]?.status).toBe('pending')
    active = true; loseRace = true
    expect(await (await request(`/connections/callback?approval=${approval.id}`)).text()).toContain('openstaff:connected')
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns))[0]?.status).toBe('done'))
    expect((await api.database.db.select().from(approvals))[0]?.status).toBe('approved')
    expect(client.execute).not.toHaveBeenCalled()
    const spent = await request(`/connections/callback?approval=${approval.id}`)
    expect(spent.status).toBe(200)
    expect(await spent.text()).toContain('already completed')
    vi.mocked(client.link).mockRejectedValueOnce(new Error('Composio rejected that API key.'))
    const broken = await request('/connections/start?toolkit=gmail')
    expect(broken.status).toBe(200)
    const brokenHtml = await broken.text()
    expect(brokenHtml).toContain('Could not connect Gmail')
    expect(brokenHtml).toContain('Composio rejected that API key.')
  } finally { await api.stop(); await fs.rm(directory, { recursive: true, force: true }) }
})

it('keeps a personal account to its own member and makes a workspace account available to everyone', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'connection-scopes-'))
  let accounts: ComposioConnection[] = []
  const client: ComposioClient = {
    connections: vi.fn(async (userIds) => accounts.filter((row) => userIds.includes(row.userId))),
    search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: 'Read Gmail' }),
    execute: async () => ({ inbox: 'Hello' }),
    link: vi.fn(async (toolkit, userId) => { accounts.push({ id: `${toolkit}:${userId}`, toolkit, status: 'ACTIVE', createdAt: new Date().toISOString(), userId }); return { redirectUrl: 'https://example.com/signin' } }),
    disconnect: async (id) => { accounts = accounts.filter((row) => row.id !== id); return {} },
    toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: 'Read Gmail' }],
  }
  const model = new MockLanguageModelV3({ doStream: [connectRequest('owner-mail'), textStream('Owner is connected.'), connectRequest('ana-mail'), textStream('Ana is connected.')] })
  const api = await startServer({ config: { dataDir: directory, port: 0, signupCode: '', authSignup: 'open' }, composioClient: client, modelResolver: () => model })
  const request = (cookie: string, route: string, body?: unknown) => fetch(`${api.url}/api${route}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' })
  const ask = async (cookie: string, name: string) => {
    const { room } = await (await request(cookie, '/bots', { name, job: 'Mail', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' })).json() as { room: { id: string } }
    expect((await request(cookie, `/rooms/${room.id}/messages`, { text: 'Read Gmail', clientRequestId: `ask-${name}` })).status).toBe(201)
    return vi.waitFor(async () => {
      const row = (await api.database.db.select().from(approvals)).find((item) => item.roomId === room.id)
      expect(row?.status).toBe('pending')
      return row!
    })
  }
  const connected = async (cookie: string) => ((await (await request(cookie, '/connections/apps')).json()) as { apps: Array<{ slug: string; status: string; scope?: string }> }).apps.find((app) => app.slug === 'gmail')
  try {
    const owner = await signedIn(api, { name: 'Juan', email: 'juan@example.test', role: 'owner' })
    const member = await signedIn(api, { name: 'Ana', email: 'ana@example.test', role: 'member' })
    const ownerApproval = await ask(owner.cookie, 'Mail bot')
    expect((await request(owner.cookie, `/connections/start?approval=${ownerApproval.id}`)).status).toBe(302)
    expect(client.link).toHaveBeenCalledWith('gmail', `workspace:${owner.user.id}`, expect.stringContaining('scope=member'))
    expect(await (await request(owner.cookie, `/connections/callback?approval=${ownerApproval.id}`)).text()).toContain('openstaff:connected')
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns)).find((turn) => turn.id === ownerApproval.turnId)?.status).toBe('done'))
    expect(await connected(owner.cookie)).toMatchObject({ status: 'connected', scope: 'member' })
    // Ana's bot cannot borrow Juan's inbox, so her own turn pauses for a connection of her own.
    expect(await connected(member.cookie)).toMatchObject({ status: 'not connected' })
    const memberApproval = await ask(member.cookie, 'Ana bot')
    expect(memberApproval.turnId).not.toBe(ownerApproval.turnId)
    expect((await request(member.cookie, `/approvals/${memberApproval.id}`, { decision: 'approve' })).status).toBe(409)
    const refused = await request(member.cookie, '/connections/start?toolkit=gmail&scope=workspace')
    expect(refused.status).toBe(200)
    expect(await refused.text()).toContain('Only an owner or admin can connect an app for the whole workspace.')
    expect((await request(owner.cookie, '/connections/start?toolkit=gmail&scope=workspace')).status).toBe(302)
    expect(client.link).toHaveBeenLastCalledWith('gmail', 'workspace', expect.stringContaining('scope=workspace'))
    expect(await (await request(owner.cookie, '/connections/callback?toolkit=gmail&scope=workspace')).text()).toContain('openstaff:connected')
    expect(await connected(member.cookie)).toMatchObject({ status: 'connected', scope: 'workspace' })
    expect(await connected(owner.cookie)).toMatchObject({ status: 'connected', scope: 'member' })
    expect((await request(member.cookie, `/approvals/${memberApproval.id}`, { decision: 'approve' })).status).toBe(200)
    await vi.waitFor(async () => expect((await api.database.db.select().from(turns)).find((turn) => turn.id === memberApproval.turnId)?.status).toBe('done'))
  } finally { await api.stop(); await fs.rm(directory, { recursive: true, force: true }) }
})
