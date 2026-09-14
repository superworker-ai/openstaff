import { randomBytes } from 'node:crypto'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { fakeOAuthServer, writeOAuthPlugin } from '../test/fake-oauth.js'
import { textStream } from '../test/mock-model.js'
import { Secrets } from '../secrets.js'
import { PluginInstaller } from '../plugins/installer.js'
import { PluginRegistry } from '../plugins/registry.js'
import { ComposioService } from '../composio/service.js'
import { turns, turnEvents } from '../db/schema.js'
import { AgentRuntime } from './runtime.js'
import { AgentConnections } from './connections.js'
import { toolApprovalFor } from './approval-policy.js'

it('only connected MCP and Composio tools reach the model and status events measure the reduction', async () => {
  const f = await fixture(), fake = await fakeOAuthServer(), secrets = new Secrets(randomBytes(32)), registry = new PluginRegistry(f.db, secrets)
  let active = false
  const execute = vi.fn(async () => ({}))
  const composio = new ComposioService(f.db, f.admission, { get: () => undefined }, f.directory, {
    connections: async () => active ? [{ id: 'gmail', toolkit: 'gmail', status: 'ACTIVE', createdAt: new Date().toISOString() }] : [], search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'gmail', description: '' }), execute, link: async () => ({ redirectUrl: 'https://example.com' }), toolkits: async () => [{ slug: 'gmail', name: 'Gmail', description: '' }],
  })
  try {
    const id = await new PluginInstaller(f.db, f.directory, secrets, registry).install(`path:${await writeOAuthPlugin(f.directory, fake.url)}`)
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Hello' })
    const turn = (await f.db.select().from(turns))[0]!, model = new MockLanguageModelV3({ doStream: async () => textStream('Hello.') })
    const runtime = new AgentRuntime({ ...f, registry, composio, contextMessages: 60, modelResolver: () => model })
    await runtime.run(turn)
    const hidden = model.doStreamCalls[0]!.tools!.map((tool) => tool.name)
    expect(hidden).toContain('request_connection')
    expect(hidden).not.toContain('gmail__read_mail')
    expect(hidden).not.toContain('composio_execute')
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('Gmail — installed, not connected')
    expect((await f.db.select().from(turnEvents)).find((event) => event.payload.tools)?.payload).toMatchObject({ tools: hidden.length, hiddenApps: expect.arrayContaining(['Gmail', 'Notion']) })
    const connections = new AgentConnections(registry, composio)
    const gate = toolApprovalFor('auto', new Set(), undefined, async (call) => (await connections.missing(call.toolName, call.input))?.appName)
    expect(await gate({ toolCall: { toolName: 'composio_execute', input: { slug: 'GMAIL_GET_EMAILS' } } })).toEqual({ type: 'user-approval', reason: 'connect:Gmail' })
    expect(execute).not.toHaveBeenCalled()
    await (await registry.oauth.server(id, 'Gmail')).saveTokens({ access_token: 'access-initial', token_type: 'Bearer' })
    active = true
    await composio.listConnections(true)
    await runtime.run(turn)
    const shown = model.doStreamCalls[1]!.tools!.map((tool) => tool.name)
    expect(shown).toContain('gmail__read_mail')
    expect(shown).toContain('composio_execute')
    expect(shown.length).toBeGreaterThan(hidden.length)
    expect(fake.toolCalls).toHaveLength(0)
  } finally { await registry.mcpPool.close(); await fake.stop(); await f.close() }
})
