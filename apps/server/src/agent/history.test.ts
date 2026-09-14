import { expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { fixture } from '../test/fixture.js'
import { mockUsage } from '../test/mock-model.js'
import { loadRoomHistory } from './history.js'
import { buildTurnPrompt } from './prompt.js'
import { AgentRuntime } from './runtime.js'
import { turns } from '../db/schema.js'

it('uses the newest history, includes replies, and labels all authors in decisions and prompts', async () => {
  const f = await fixture()
  try {
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'oldest' })
    const trigger = await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, text: '@Juan handoff', planReplies: false })
    await f.admission.post({ roomId: f.roomId, authorKind: 'system', authorId: null, text: 'Automation tick', planReplies: false })
    expect(await loadRoomHistory(f.db, f.roomId, 2)).toBe('[drake] @Juan handoff\n[System] Automation tick')
    const prompt = await buildTurnPrompt(f.db, f.computer, { roomId: f.roomId, botId: f.botId, triggerMessageId: trigger.message.id }, 2)
    expect(prompt.messages[0]?.content).toContain('[Juan] oldest')
    expect(prompt.messages[1]?.content).toBe('[drake] @Juan handoff')
    expect(prompt.instructions).toContain('to delegate, use the handoff tool')
    expect(prompt.instructions).toContain('use their first name or nothing')
    const model = new MockLanguageModelV3({ doGenerate: async (options) => {
      const text = JSON.stringify(options.prompt)
      expect(text).toContain('[drake] @Juan handoff')
      expect(text).toContain('[System] Automation tick')
      expect(text).not.toContain('oldest')
      expect(text).toContain('agreement, acknowledgement, emoji-only')
      return { content: [{ type: 'text', text: '{"reply":false,"reason":"Nothing to add"}' }], finishReason: { unified: 'stop', raw: undefined }, usage: mockUsage, warnings: [] }
    } })
    const turn = (await f.db.select().from(turns))[0]!
    const runtime = new AgentRuntime({ ...f, contextMessages: 2, modelResolver: () => model })
    expect(await runtime.decideReply(turn)).toBe(false)
  } finally { await f.close() }
})

it('labels the last three bot replies to the same trigger for the reply decision', async () => {
  const f = await fixture()
  try {
    const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Work' })
    for (let n = 0; n < 4; n++) await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: f.botId, turnId: posted.turns[0]!.id, text: `reply-${n}`, planReplies: false })
    const model = new MockLanguageModelV3({ doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt), section = prompt.split('Last 3 bot replies')[1]!.split('Room history:')[0]!
      expect(section).not.toContain('reply-0')
      for (let n = 1; n < 4; n++) expect(section).toContain(`[drake] reply-${n}`)
      return { content: [{ type: 'text', text: '{"reply":false,"reason":"repetition"}' }], finishReason: { unified: 'stop', raw: undefined }, usage: mockUsage, warnings: [] }
    } })
    await new AgentRuntime({ ...f, contextMessages: 60, modelResolver: () => model }).decideReply((await f.db.select().from(turns))[0]!)
  } finally { await f.close() }
})

it('tells the bot the current date and time in the turn instructions', async () => {
  const f = await fixture()
  try {
    const trigger = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'what day is it?' })
    const now = new Date('2026-09-14T15:04:05.000Z')
    const prompt = await buildTurnPrompt(f.db, f.computer, { roomId: f.roomId, botId: f.botId, triggerMessageId: trigger.message.id }, 2, undefined, undefined, now)
    expect(prompt.instructions).toContain('Environment\nCurrent date and time: 2026-09-14T15:04:05.000Z (UTC)')
    expect(prompt.instructions).toContain(`server timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`)
    expect(prompt.instructions.indexOf('Environment\n')).toBeLessThan(prompt.instructions.indexOf('Room contract\n'))
  } finally { await f.close() }
})
