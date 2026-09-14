import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it } from 'vitest'
import { AgentRuntime, appendApprovalResponse } from '../agent/runtime.js'
import { approvals, rooms, turns } from '../db/schema.js'
import { Secrets } from '../secrets.js'
import { PluginRegistry } from '../plugins/registry.js'
import { PluginInstaller } from '../plugins/installer.js'
import { fixture } from '../test/fixture.js'
import { fakeOAuthServer, writeOAuthPlugin } from '../test/fake-oauth.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'

it.each(['request_connection'])('%s pauses with a connect card before executing and resumes with a denied output for Not now', async (toolName) => {
  const f = await fixture(), fake = await fakeOAuthServer(), secrets = new Secrets(randomBytes(32)), installed = new PluginRegistry(f.db, secrets)
  try {
    await new PluginInstaller(f.db, f.directory, secrets, installed).install(`path:${await writeOAuthPlugin(f.directory, fake.url)}`)
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Read my mail' })
    const stored = (await f.db.select().from(turns))[0]!
    const model = new MockLanguageModelV3({ doStream: [
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'read', toolName, input: toolName === 'request_connection' ? '{"app":"Gmail"}' : '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      textStream('Gmail is not connected yet. I cannot read your mail.'),
    ] })
    const runtime = new AgentRuntime({ ...f, registry: installed, contextMessages: 60, modelResolver: () => model })
    expect(await runtime.run(stored)).toEqual({ kind: 'waiting' })
    const approval = (await f.db.select().from(approvals))[0]!
    expect(approval).toMatchObject({ kind: 'connect', status: 'pending', connection: { source: 'mcp', appName: 'Gmail' }, summary: 'drake needs Gmail connected' })
    expect(fake.toolCalls).toHaveLength(0)
    expect((await f.db.select().from(rooms))[0]?.lastMessagePreview).toBe('drake needs Gmail connected')
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('installed, not connected')
    const resumed = await appendApprovalResponse(f.db, approval.id, false, 'Not now')
    expect(await runtime.run(resumed!)).toMatchObject({ kind: 'done', text: 'Gmail is not connected yet. I cannot read your mail.' })
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('denied')
    expect(fake.toolCalls).toHaveLength(0)
  } finally { await installed.mcpPool.close(); await fake.stop(); await f.close() }
})

it('a revoked MCP token becomes a connect pause and executes with fresh credentials on resume', async () => {
  const f = await fixture(), fake = await fakeOAuthServer(), secrets = new Secrets(randomBytes(32)), registry = new PluginRegistry(f.db, secrets)
  try {
    const id = await new PluginInstaller(f.db, f.directory, secrets, registry).install(`path:${await writeOAuthPlugin(f.directory, fake.url)}`)
    const provider = await registry.oauth.server(id, 'Gmail')
    await provider.saveTokens({ access_token: 'invalid', token_type: 'Bearer' })
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Read mail' })
    const stored = (await f.db.select().from(turns))[0]!
    const model = new MockLanguageModelV3({ doStream: [
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'read', toolName: 'gmail__read_mail', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'retry-read', toolName: 'gmail__read_mail', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      textStream('Mail read.'),
    ] })
    const runtime = new AgentRuntime({ ...f, registry, contextMessages: 60, modelResolver: () => model })
    expect(await runtime.run(stored)).toEqual({ kind: 'waiting' })
    const approval = (await f.db.select().from(approvals))[0]!
    expect(approval).toMatchObject({ kind: 'connect', resumeMode: 'retry' })
    expect(fake.toolCalls).toHaveLength(1)
    expect(JSON.stringify((await f.db.select().from(turns))[0]?.modelMessages)).toContain('connection expired')
    await provider.saveTokens({ access_token: 'access-initial', token_type: 'Bearer' })
    const resumed = await appendApprovalResponse(f.db, approval.id, true)
    expect(await runtime.run(resumed!)).toMatchObject({ kind: 'done', text: 'Mail read.' })
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('Retry the failed action')
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain('Inbox: hello from fake OAuth')
    expect(fake.toolCalls).toHaveLength(2)
    expect((await f.db.select().from(approvals).where(eq(approvals.id, approval.id)))[0]?.status).toBe('approved')
  } finally { await registry.mcpPool.close(); await fake.stop(); await f.close() }
})
