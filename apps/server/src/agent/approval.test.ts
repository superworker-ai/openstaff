import fs from 'node:fs/promises'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type Turn } from '@openstaff/shared'
import { LocalComputer } from '../computer/local.js'
import { createDatabase, type DatabaseHandle } from '../db/index.js'
import { approvals, bots, messages, roomMembers, rooms, turnEvents, turns, users } from '../db/schema.js'
import { AdmissionService } from '../rooms/admission.js'
import { TurnScheduler } from '../rooms/scheduler.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { AgentRuntime, appendApprovalResponse } from './runtime.js'

describe('approval pause and resume', () => {
  let directory = ''
  let handle: DatabaseHandle
  let computer: LocalComputer
  const userId = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV'
  const botId = 'bot_01ARZ3NDEKTSV4RRFFQ69G5FAV'
  const roomId = 'room_01ARZ3NDEKTSV4RRFFQ69G5FAV'

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.resolve('data-test-approval-'))
    handle = await createDatabase(directory)
    computer = new LocalComputer(path.join(directory, 'workspace'))
    await computer.initialize()
    const now = new Date().toISOString()
    await handle.db.insert(users).values({ id: userId, email: 'approval@example.com', name: 'Owner', passwordHash: 'x', avatar: null, role: 'owner', createdAt: now })
    await handle.db.insert(bots).values({ id: botId, slug: 'writer', name: 'Writer', avatar: { shape: 'circle', color: '#2E90FA' }, job: 'Writer', instructions: '', model: 'xai/mock', reasoningEffort: null, approvalPolicy: 'writes', status: 'working', createdBy: userId, createdAt: now })
    await handle.db.insert(rooms).values({ id: roomId, kind: 'dm', name: null, section: null, createdBy: userId, lastMessageAt: now, lastMessagePreview: 'write' })
    await handle.db.insert(roomMembers).values([{ roomId, memberKind: 'user', memberId: userId, joinedAt: now }, { roomId, memberKind: 'bot', memberId: botId, joinedAt: now }])
  })

  afterEach(async () => { handle.close(); await fs.rm(directory, { recursive: true, force: true }) })

  it('persists an approval request, resumes, and executes the approved tool', async () => {
    const trigger = { id: createId('message'), roomId, seq: 1, authorKind: 'user' as const, authorId: userId, text: 'Write a greeting file', mentions: [], attachments: [], turnId: null, clientRequestId: 'approval-test', createdAt: new Date().toISOString() }
    await handle.db.insert(messages).values(trigger)
    const turn: Turn = { id: createId('turn'), roomId, botId, triggerMessageId: trigger.id, replyMode: 'direct', status: 'running', model: 'xai/mock', modelMessages: [], usage: null, error: null, startedAt: new Date().toISOString(), finishedAt: null, handoffDepth: 0 }
    await handle.db.insert(turns).values(turn)
    const model = new MockLanguageModelV3({ doStream: [
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call-1', toolName: 'write_file', input: '{"path":"hello.txt","content":"hello"}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      textStream('Done.'),
    ] })
    const admission = new AdmissionService(handle.db)
    const runtime = new AgentRuntime({ db: handle.db, computer, admission, contextMessages: 60, modelResolver: () => model })
    await expect(runtime.run(turn)).resolves.toEqual({ kind: 'waiting' })
    const approval = (await handle.db.select().from(approvals).where(eq(approvals.turnId, turn.id)).limit(1))[0]!
    expect(approval.status).toBe('pending')
    const resumed = await appendApprovalResponse(handle.db, approval.id, true, 'Approved in test')
    expect(resumed?.status).toBe('queued')
    await expect(runtime.run({ ...resumed!, status: 'running' })).resolves.toMatchObject({ kind: 'done', text: 'Done.' })
    await expect(computer.readFile('hello.txt')).resolves.toBe('hello')
  })

  it('returns a denied tool output to the model and continues without executing it', async () => {
    const trigger = { id: createId('message'), roomId, seq: 1, authorKind: 'user' as const, authorId: userId, text: 'Write a secret file', mentions: [], attachments: [], turnId: null, clientRequestId: 'denial-test', createdAt: new Date().toISOString() }
    await handle.db.insert(messages).values(trigger)
    const turn: Turn = { id: createId('turn'), roomId, botId, triggerMessageId: trigger.id, replyMode: 'direct', status: 'running', model: 'xai/mock', modelMessages: [], usage: null, error: null, startedAt: new Date().toISOString(), finishedAt: null, handoffDepth: 0 }
    await handle.db.insert(turns).values(turn)
    const model = new MockLanguageModelV3({ doStream: [
      mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call-denied', toolName: 'write_file', input: '{"path":"denied.txt","content":"secret"}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }]),
      textStream('I did not write the file.'),
    ] })
    const admission = new AdmissionService(handle.db)
    const runtime = new AgentRuntime({ db: handle.db, computer, admission, contextMessages: 60, modelResolver: () => model })
    await runtime.run(turn)
    const approval = (await handle.db.select().from(approvals).where(eq(approvals.turnId, turn.id)).limit(1))[0]!
    const resumed = await appendApprovalResponse(handle.db, approval.id, false, 'Not allowed')
    await expect(runtime.run({ ...resumed!, status: 'running' })).resolves.toMatchObject({ kind: 'done', text: 'I did not write the file.' })
    await expect(computer.readFile('denied.txt')).rejects.toThrow()
  })

  it.each([true, false])('resumes two shell approvals only after both decisions (second approved: %s), preserving an automatic read', async (secondApproved) => {
    await computer.writeFile('seed.txt', 'existing context')
    const exec = vi.spyOn(computer, 'exec'), read = vi.spyOn(computer, 'readFile')
    const model = new MockLanguageModelV3({ doStream: [mockStream([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'call_A', toolName: 'shell', input: JSON.stringify({ command: 'printf A >> a.txt' }) },
      { type: 'tool-call', toolCallId: 'call_read', toolName: 'read_file', input: JSON.stringify({ path: 'seed.txt' }) },
      { type: 'tool-call', toolCallId: 'call_B', toolName: 'shell', input: JSON.stringify({ command: 'printf B >> b.txt' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
    ]), textStream('Finished the approved work.') ] })
    const admission = new AdmissionService(handle.db)
    const runtime = new AgentRuntime({ db: handle.db, computer, admission, contextMessages: 60, modelResolver: () => model })
    const scheduler = new TurnScheduler(handle.db, runtime, admission, undefined, 1)
    try {
      const admitted = await admission.post({ roomId, authorKind: 'user', authorId: userId, text: 'Run both commands and read the context' })
      const turn = (await handle.db.select().from(turns).where(eq(turns.id, admitted.turns[0]!.id)))[0]!
      await expect(runtime.run({ ...turn, status: 'running' })).resolves.toEqual({ kind: 'waiting' })
      const rows = await handle.db.select().from(approvals).where(eq(approvals.turnId, turn.id))
      expect(rows).toHaveLength(2)
      const first = rows.find((row) => JSON.stringify(row.input).includes('a.txt'))!, second = rows.find((row) => JSON.stringify(row.input).includes('b.txt'))!
      const cards = (await handle.db.select().from(messages).orderBy(asc(messages.seq))).filter((message) => message.authorKind === 'system')
      expect(cards.map((card) => card.attachments[0]?.approvalId)).toEqual([first.id, second.id])
      expect(exec).not.toHaveBeenCalled()
      expect(read.mock.calls.filter(([file]) => file === 'seed.txt')).toHaveLength(1)
      // Decide B first to verify response ordering follows creation, not clicks.
      const partial = await appendApprovalResponse(handle.db, second.id, secondApproved, 'Decision on B')
      expect(partial?.status).toBe('waiting_approval')
      expect((await handle.db.select().from(bots).where(eq(bots.id, botId)))[0]?.status).toBe('waiting_approval')
      expect(model.doStreamCalls).toHaveLength(1)
      expect(exec).not.toHaveBeenCalled()
      expect((await handle.db.select().from(rooms).where(eq(rooms.id, roomId)))[0]?.lastMessagePreview).toBe('Writer needs approval')
      expect((await handle.db.select().from(approvals).where(eq(approvals.id, second.id)))[0]?.status).toBe(secondApproved ? 'approved' : 'denied')
      expect(await appendApprovalResponse(handle.db, second.id, !secondApproved)).toBeNull()
      const resumed = await appendApprovalResponse(handle.db, first.id, true)
      expect(resumed?.status).toBe('queued')
      expect(resumed?.modelMessages.at(-1)).toMatchObject({ role: 'tool', content: [
        { type: 'tool-approval-response', approvalId: first.approvalId, approved: true },
        { type: 'tool-approval-response', approvalId: second.approvalId, approved: secondApproved, reason: 'Decision on B' },
      ] })
      scheduler.enqueue([resumed!])
      await vi.waitFor(async () => expect((await handle.db.select().from(turns).where(eq(turns.id, turn.id)))[0]?.status).toBe('done'))
      expect(exec).toHaveBeenCalledTimes(secondApproved ? 2 : 1)
      expect(read.mock.calls.filter(([file]) => file === 'seed.txt')).toHaveLength(1)
      expect(await computer.readFile('a.txt')).toBe('A')
      if (secondApproved) expect(await computer.readFile('b.txt')).toBe('B')
      else {
        await expect(computer.readFile('b.txt')).rejects.toThrow()
        const events = await handle.db.select().from(turnEvents).where(eq(turnEvents.turnId, turn.id))
        expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ payload: expect.objectContaining({ toolCallId: 'call_B', denied: true }) })]))
        const outputs = model.doStreamCalls[1]!.prompt.flatMap((message) => message.role === 'tool' ? message.content : [])
        expect(outputs).toEqual(expect.arrayContaining([expect.objectContaining({ toolCallId: 'call_B', output: expect.objectContaining({ type: 'execution-denied' }) })]))
      }
      const replies = (await handle.db.select().from(messages)).filter((message) => message.authorKind === 'bot')
      expect(replies.map((message) => message.text)).toEqual(['Finished the approved work.'])
    } finally { await scheduler.shutdown() }
  })

  it('does not append old approval responses again when a later step needs approval', async () => {
    const call = (id: string) => mockStream([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: id, toolName: 'shell', input: JSON.stringify({ command: `printf ${id} >> history.txt` }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
    ])
    const model = new MockLanguageModelV3({ doStream: [call('A'), call('B'), textStream('Both steps finished.')] })
    const admission = new AdmissionService(handle.db)
    const runtime = new AgentRuntime({ db: handle.db, computer, admission, contextMessages: 60, modelResolver: () => model })
    await admission.post({ roomId, authorKind: 'user', authorId: userId, text: 'Work in two steps' })
    const turn = (await handle.db.select().from(turns))[0]!
    await runtime.run({ ...turn, status: 'running' })
    const first = (await handle.db.select().from(approvals))[0]!
    const firstResume = await appendApprovalResponse(handle.db, first.id, true)
    await expect(runtime.run({ ...firstResume!, status: 'running' })).resolves.toEqual({ kind: 'waiting' })
    const second = (await handle.db.select().from(approvals)).find((item) => item.id !== first.id)!
    const secondResume = await appendApprovalResponse(handle.db, second.id, true)
    const history = JSON.stringify(secondResume!.modelMessages)
    expect(history.match(/"type":"tool-approval-response"/g)).toHaveLength(2)
    expect(secondResume?.modelMessages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-approval-response', approvalId: second.approvalId, approved: true }] })
    await expect(runtime.run({ ...secondResume!, status: 'running' })).resolves.toMatchObject({ kind: 'done', text: 'Both steps finished.' })
    expect(await computer.readFile('history.txt')).toBe('AB')
  })

  it('queues only once when two approvals are decided concurrently', async () => {
    const model = new MockLanguageModelV3({ doStream: mockStream([
      { type: 'stream-start', warnings: [] },
      ...['A', 'B'].map((id) => ({ type: 'tool-call' as const, toolCallId: id, toolName: 'shell', input: JSON.stringify({ command: `printf ${id}` }) })),
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
    ]) })
    const admission = new AdmissionService(handle.db)
    const runtime = new AgentRuntime({ db: handle.db, computer, admission, contextMessages: 60, modelResolver: () => model })
    await admission.post({ roomId, authorKind: 'user', authorId: userId, text: 'Run both' })
    const turn = (await handle.db.select().from(turns))[0]!
    await runtime.run({ ...turn, status: 'running' })
    const rows = await handle.db.select().from(approvals)
    const results = await Promise.all(rows.map((row) => appendApprovalResponse(handle.db, row.id, true, 'Confirmed')))
    expect(results.map((result) => result?.status).sort()).toEqual(['queued', 'waiting_approval'])
    expect((await handle.db.select().from(approvals)).map((row) => row.status)).toEqual(['approved', 'approved'])
  })
})
