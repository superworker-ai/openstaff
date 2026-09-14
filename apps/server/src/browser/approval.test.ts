import { createServer } from 'node:http'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it } from 'vitest'
import { fixture } from '../test/fixture.js'
import { approvals, turns } from '../db/schema.js'
import { AgentRuntime, appendApprovalResponse } from '../agent/runtime.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { BrowserService } from './service.js'
import { HUMAN_COMPLETED_TOOL_RESULT } from '../agent/approval-responses.js'

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('retains the browser page across approval pause/resume', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>Before</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Change</button>') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  let call = 0
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    call++
    if (call === 3) { expect(JSON.stringify(options.prompt)).toContain('Clicked'); return textStream('Changed it.') }
    return mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: `call-${call}`, toolName: call === 1 ? 'browser_navigate' : 'browser_click', input: JSON.stringify(call === 1 ? { url: `http://127.0.0.1:${(server.address() as { port: number }).port}` } : { selector: 'button' }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
  } })
  const runtime = new AgentRuntime({ ...f, browser, contextMessages: 60, modelResolver: () => model })
  try {
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Click Change' })
    const turn = (await f.db.select().from(turns))[0]!
    expect(await runtime.run(turn)).toEqual({ kind: 'waiting' })
    const approval = (await f.db.select().from(approvals))[0]!
    expect(approval.summary).toBe('Click button')
    const resumed = await appendApprovalResponse(f.db, approval.id, true)
    const result = await runtime.run(resumed!)
    expect(result).toMatchObject({ kind: 'done', text: 'Changed it.', usage: { totalTokens: 45 } })
  } finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await f.close() }
}, 40_000)

it('resumes a browser approval with the human-completed tool output', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  let call = 0
  const model = new MockLanguageModelV3({ doStream: async (options) => {
    call += 1
    if (call === 2) {
      const denied = options.prompt.flatMap((message) => message.role === 'tool' ? message.content : []).find((part) => part.type === 'tool-result')
      expect(denied).toMatchObject({ output: { type: 'execution-denied', reason: HUMAN_COMPLETED_TOOL_RESULT } })
      return textStream('Continued from the human step.')
    }
    return mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'human-step', toolName: 'browser_click', input: JSON.stringify({ selector: 'button' }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
  } })
  const runtime = new AgentRuntime({ ...f, browser, contextMessages: 60, modelResolver: () => model })
  try {
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Let me finish this browser step' })
    const turn = (await f.db.select().from(turns))[0]!
    await expect(runtime.run(turn)).resolves.toEqual({ kind: 'waiting' })
    const approval = (await f.db.select().from(approvals))[0]!
    const resumed = await appendApprovalResponse(f.db, approval.id, 'human_completed')
    expect(resumed?.modelMessages.at(-1)).toMatchObject({ role: 'tool', content: [{ approved: false, reason: HUMAN_COMPLETED_TOOL_RESULT }] })
    await expect(runtime.run(resumed!)).resolves.toMatchObject({ kind: 'done', text: 'Continued from the human step.' })
  } finally { await browser.close(); await f.close() }
})
