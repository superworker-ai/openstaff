import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createApplication, type Application } from '../app.js'
import type { ComposioClient, ComposioConnection } from '../composio/client.js'
import { signedIn } from '../test/auth.js'

const applications: Application[] = []
const directories: string[] = []
afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function workspaceWithMembers() {
  const directory = await fs.mkdtemp(path.resolve('data-test-connections-api-'))
  directories.push(directory)
  let accounts: ComposioConnection[] = []
  const client: ComposioClient = {
    connections: async (userIds) => accounts.filter((row) => userIds.includes(row.userId)),
    search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), execute: async () => ({}),
    link: async () => ({ redirectUrl: 'https://example.com/signin' }), toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: '' }],
    disconnect: vi.fn(async (id: string) => { accounts = accounts.filter((row) => row.id !== id); return {} }),
  }
  const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0, authSignup: 'open' }, composioClient: client })
  applications.push(application)
  const owner = await signedIn(application, { name: 'Juan', role: 'owner' })
  const member = await signedIn(application, { name: 'Ana', role: 'member' })
  const createdAt = new Date().toISOString()
  accounts = [
    { id: 'shared', toolkit: 'gmail', status: 'ACTIVE', createdAt, userId: 'workspace' },
    { id: 'owner-personal', toolkit: 'notion', status: 'ACTIVE', createdAt, userId: `workspace:${owner.user.id}` },
    { id: 'member-personal', toolkit: 'slack', status: 'ACTIVE', createdAt, userId: `workspace:${member.user.id}` },
    { id: 'member-second', toolkit: 'todoist', status: 'ACTIVE', createdAt, userId: `workspace:${member.user.id}` },
  ]
  const request = (cookie: string, url: string, method = 'GET') => application.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' } })
  return { application, client, owner, member, request, accounts: () => accounts }
}

it('lists a member their own and the workspace accounts, and an owner everyone else’s by name', async () => {
  const h = await workspaceWithMembers()
  const list = async (cookie: string) => (await (await h.request(cookie, '/api/connections')).json()) as { canManageWorkspace: boolean; connections: Array<{ id: string; scope: string; userId: string | null; userName?: string | null }> }
  const forMember = await list(h.member.cookie)
  expect(forMember.canManageWorkspace).toBe(false)
  expect(forMember.connections.map((row) => row.id).sort()).toEqual(['member-personal', 'member-second', 'shared'])
  expect(forMember.connections.every((row) => row.userName === undefined)).toBe(true)
  const forOwner = await list(h.owner.cookie)
  expect(forOwner.canManageWorkspace).toBe(true)
  expect(forOwner.connections.map((row) => row.id).sort()).toEqual(['member-personal', 'member-second', 'owner-personal', 'shared'])
  expect(forOwner.connections.find((row) => row.id === 'member-personal')).toMatchObject({ scope: 'member', userId: h.member.user.id, userName: 'Ana' })
  expect(forOwner.connections.find((row) => row.id === 'owner-personal')?.userName).toBeUndefined()
})

it('lets a member remove only their own account while an owner may remove any', async () => {
  const h = await workspaceWithMembers()
  for (const id of ['shared', 'owner-personal']) {
    const denied = await h.request(h.member.cookie, `/api/connections/${id}`, 'DELETE')
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'forbidden' })
  }
  expect((await h.request(h.member.cookie, '/api/connections/missing', 'DELETE')).status).toBe(404)
  expect(h.client.disconnect).not.toHaveBeenCalled()
  expect((await h.request(h.member.cookie, '/api/connections/member-personal', 'DELETE')).status).toBe(200)
  for (const id of ['shared', 'member-second']) expect((await h.request(h.owner.cookie, `/api/connections/${id}`, 'DELETE')).status).toBe(200)
  expect(h.accounts().map((row) => row.id)).toEqual(['owner-personal'])
})

it('refuses a workspace-wide link to a plain member at both entry points', async () => {
  const h = await workspaceWithMembers()
  const popup = await h.request(h.member.cookie, '/api/connections/start?toolkit=gmail&scope=workspace')
  expect(popup.status).toBe(200)
  expect(await popup.text()).toContain('Only an owner or admin can connect an app for the whole workspace.')
  const posted = await h.application.app.request('/api/connections/link', { method: 'POST', headers: { cookie: h.member.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ toolkit: 'gmail', scope: 'workspace' }) })
  expect(posted.status).toBe(403)
  expect(await posted.json()).toMatchObject({ code: 'forbidden' })
  expect((await h.request(h.member.cookie, '/api/connections/start?toolkit=gmail')).status).toBe(302)
})
