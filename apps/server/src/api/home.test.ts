import fs from 'node:fs/promises'
import path from 'node:path'
import { MockLanguageModelV3 } from 'ai/test'
import { createId } from '@openstaff/shared'
import { describe, expect, it, vi } from 'vitest'
import { createApplication } from '../app.js'
import { MissingApiKeyError, type ModelResolver } from '../agent/models.js'
import { automationInvocations, automationRuns, automations, approvals, messages, turnEvents, turns } from '../db/schema.js'
import { mockUsage } from '../test/mock-model.js'

async function seededHome(modelResolver: ModelResolver) {
  const directory = await fs.mkdtemp(path.resolve('data-test-home-api-'))
  const application = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 }, modelResolver })
  let cookie = ''
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await application.app.request(url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { response, data: await response.json() as Record<string, any> }
  }
  const signup = await request('/api/auth/signup', 'POST', { name: 'Owner', email: `${createId('user')}@example.test`, password: 'password123' })
  cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
  const admiral = await request('/api/bots', 'POST', { name: 'Admiral', job: 'Engineer', avatar: { shape: 'circle', color: '#F04438' } })
  const ops = await request('/api/bots', 'POST', { name: 'Ops', job: 'Operations', avatar: { shape: 'triangle', color: '#F79009' } })
  const userId = signup.data.user.id as string
  const admiralId = admiral.data.bot.id as string, admiralRoomId = admiral.data.room.id as string
  const opsId = ops.data.bot.id as string, opsRoomId = ops.data.room.id as string
  const current = Date.now(), recent = new Date(current - 10 * 60_000).toISOString(), finished = new Date(current - 5 * 60_000).toISOString()
  const old = new Date(current - 30 * 60 * 60_000).toISOString(), future = new Date(current + 2 * 60 * 60_000).toISOString()
  const runningTrigger = createId('message'), doneTrigger = createId('message'), failedTrigger = createId('message')
  const runningTurn = createId('turn'), doneTurn = createId('turn'), failedTurn = createId('turn')
  const automationId = createId('automation'), invocationId = createId('invocation')

  await application.database.db.insert(messages).values([
    { id: runningTrigger, roomId: admiralRoomId, seq: 1, authorKind: 'user', authorId: userId, text: 'Sign up for the trial', mentions: [], attachments: [], turnId: null, clientRequestId: createId('message'), createdAt: recent },
    { id: doneTrigger, roomId: opsRoomId, seq: 1, authorKind: 'user', authorId: userId, text: 'Prepare the report', mentions: [], attachments: [], turnId: null, clientRequestId: createId('message'), createdAt: recent },
    { id: failedTrigger, roomId: opsRoomId, seq: 2, authorKind: 'system', authorId: null, text: 'Automation run', mentions: [], attachments: [], turnId: null, clientRequestId: null, createdAt: old },
  ])
  await application.database.db.insert(turns).values([
    { id: runningTurn, roomId: admiralRoomId, botId: admiralId, triggerMessageId: runningTrigger, replyMode: 'direct', status: 'running', model: 'test/model', modelMessages: [], startedAt: recent },
    { id: doneTurn, roomId: opsRoomId, botId: opsId, triggerMessageId: doneTrigger, replyMode: 'direct', status: 'done', model: 'test/model', modelMessages: [], startedAt: recent, finishedAt: finished },
    { id: failedTurn, roomId: opsRoomId, botId: opsId, triggerMessageId: failedTrigger, replyMode: 'direct', status: 'failed', model: 'test/model', modelMessages: [], error: 'Mailbox unavailable', startedAt: old, finishedAt: old },
  ])
  await application.database.db.insert(messages).values({
    id: createId('message'), roomId: opsRoomId, seq: 3, authorKind: 'bot', authorId: opsId, text: 'Weekly report is ready with 1,204 rows.', mentions: [],
    attachments: [{ subtype: 'file', name: 'weekly.csv', path: 'reports/weekly.csv', size: 49_152 }], turnId: doneTurn, clientRequestId: null, createdAt: finished,
  })
  await application.database.db.insert(turnEvents).values([
    { id: createId('event'), turnId: runningTurn, seq: 1, type: 'tool-call', payload: { toolName: 'computer_click', input: { x: 12, y: 34 } }, createdAt: recent },
    { id: createId('event'), turnId: runningTurn, seq: 2, type: 'screenshot', payload: { url: `/api/screens/${runningTurn}/1.jpg` }, createdAt: recent },
  ])
  await application.database.db.insert(approvals).values({
    id: createId('approval'), turnId: runningTurn, roomId: admiralRoomId, botId: admiralId, approvalId: 'approval-external', toolName: 'browser_click', input: { selector: '#submit' }, summary: 'Submit the signup form', status: 'pending', createdAt: recent,
  })
  await application.database.db.insert(automations).values({
    id: automationId, roomId: opsRoomId, name: 'Inbox triage', trigger: 'schedule', cron: '0 * * * *', timezone: 'UTC', prompt: 'Triage inbox', targetBotIds: [opsId], overlap: 'skip', catchUp: false,
    enabled: true, pausedReason: null, consecutiveFailures: 1, webhookKeyHash: null, lastRunAt: recent, nextRunAt: future, createdBy: userId, createdAt: recent, updatedAt: recent,
  })
  await application.database.db.insert(automationInvocations).values({
    id: invocationId, automationId, source: 'schedule', scheduledAt: recent, triggerKey: null, triggeredBy: null, messageId: failedTrigger, skipReason: null, failureCountedAt: recent, createdAt: recent, completedAt: recent,
  })
  await application.database.db.insert(automationRuns).values({ id: createId('run'), invocationId, automationId, botId: opsId, turnId: failedTurn, skipReason: null, createdAt: recent })

  return { application, directory, request, ids: { runningTurn, doneTurn, automationId, invocationId }, future }
}

async function dispose(value: Awaited<ReturnType<typeof seededHome>>) {
  await value.application.close()
  await fs.rm(value.directory, { recursive: true, force: true })
}

describe('home API', () => {
  it('returns every urgency section and a deterministic digest without a model', async () => {
    for (const key of ['XAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENCODE_API_KEY', 'AI_GATEWAY_API_KEY']) vi.stubEnv(key, '')
    const home = await seededHome(() => { throw new MissingApiKeyError('test') })
    try {
      const feed = await home.request('/api/home/feed')
      expect(feed.response.status).toBe(200)
      expect(feed.data.bots.map((bot: { name: string }) => bot.name)).toEqual(['Admiral', 'Ops'])
      expect(feed.data.needsYou).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'approval', botName: 'Admiral', browser: true, summary: 'Submit the signup form' }),
        expect.objectContaining({ kind: 'automation_failed', id: home.ids.invocationId, automationId: home.ids.automationId, botName: 'Ops', error: 'Mailbox unavailable' }),
      ]))
      expect(feed.data.now).toEqual([expect.objectContaining({ turnId: home.ids.runningTurn, toolCalls: 1, lastAction: 'Click 12,34', screenshotUrl: `/api/screens/${home.ids.runningTurn}/1.jpg` })])
      expect(feed.data.done).toEqual([expect.objectContaining({ turnId: home.ids.doneTurn, status: 'done', summary: 'Weekly report is ready with 1,204 rows.', attachments: [{ name: 'weekly.csv', path: 'reports/weekly.csv', size: 49_152 }] })])
      expect(feed.data.upcoming).toEqual([expect.objectContaining({ automationId: home.ids.automationId, name: 'Inbox triage', botNames: ['Ops'], nextRunAt: home.future })])
      expect(feed.data.onboarding).toMatchObject({ model: false, connected: false, hasBots: true, complete: false })

      const digest = await home.request('/api/home/digest')
      expect(digest.data).toMatchObject({ source: 'template', text: 'Since yesterday, Ops finished 1 task and Admiral is working on 1. Two things need you.' })
      expect(digest.data.generatedAt).toEqual(expect.any(String))
    } finally { await dispose(home); vi.unstubAllEnvs() }
  })

  it('uses and caches the workspace model digest', async () => {
    const model = new MockLanguageModelV3({ doGenerate: async (options) => {
      expect(JSON.stringify(options.prompt)).toContain('Weekly report is ready')
      return { content: [{ type: 'text', text: '**Ops** finished the weekly report. **Admiral** is working on the signup.' }], finishReason: { unified: 'stop', raw: undefined }, usage: mockUsage, warnings: [] }
    } })
    const home = await seededHome(() => model)
    try {
      const first = await home.request('/api/home/digest'), second = await home.request('/api/home/digest')
      expect(first.data).toMatchObject({ source: 'model', text: '**Ops** finished the weekly report. **Admiral** is working on the signup.' })
      expect(second.data).toEqual(first.data)
      expect(model.doGenerateCalls).toHaveLength(1)
    } finally { await dispose(home) }
  })
})
