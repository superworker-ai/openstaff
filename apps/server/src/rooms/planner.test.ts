import { describe, expect, it } from 'vitest'
import { planTurns } from './planner.js'

const botMembers = [{ id: 'bot_a' }, { id: 'bot_b' }, { id: 'bot_c' }]

describe('planTurns', () => {
  it('plans one direct turn for a human in a dm', () => {
    expect(planTurns({ roomKind: 'dm', authorKind: 'user', botMembers: [botMembers[0]!], mentions: [] }))
      .toEqual([{ botId: 'bot_a', replyMode: 'direct', handoffDepth: 0 }])
  })

  it('plans mentioned group bots directly in mention order, then others optionally', () => {
    expect(planTurns({
      roomKind: 'group', authorKind: 'user', botMembers,
      mentions: [{ kind: 'bot', id: 'bot_c' }, { kind: 'user', id: 'usr_a' }, { kind: 'bot', id: 'bot_a' }],
    })).toEqual([
      { botId: 'bot_c', replyMode: 'direct', handoffDepth: 0 },
      { botId: 'bot_a', replyMode: 'direct', handoffDepth: 0 },
      { botId: 'bot_b', replyMode: 'optional', handoffDepth: 0 },
    ])
  })

  it('plans every group bot optionally when no bot is mentioned', () => {
    expect(planTurns({ roomKind: 'group', authorKind: 'user', botMembers, mentions: [] }))
      .toEqual(botMembers.map(({ id }) => ({ botId: id, replyMode: 'optional', handoffDepth: 0 })))
  })

  it('deduplicates mentions and ignores bots outside the room', () => {
    expect(planTurns({
      roomKind: 'group', authorKind: 'user', botMembers,
      mentions: [{ kind: 'bot', id: 'bot_b' }, { kind: 'bot', id: 'bot_b' }, { kind: 'bot', id: 'bot_other' }],
    })[0]).toEqual({ botId: 'bot_b', replyMode: 'direct', handoffDepth: 0 })
  })

  it('lets bot authors trigger only mentioned bots and increments depth', () => {
    expect(planTurns({ roomKind: 'group', authorKind: 'bot', botMembers, mentions: [{ kind: 'bot', id: 'bot_b', handoff: true }], handoffDepth: 1 }))
      .toEqual([{ botId: 'bot_b', replyMode: 'direct', handoffDepth: 2 }])
  })

  it('never lets unmentioned bots react to a bot message', () => {
    expect(planTurns({ roomKind: 'group', authorKind: 'bot', botMembers, mentions: [] })).toEqual([])
    expect(planTurns({ roomKind: 'group', authorKind: 'bot', botMembers, mentions: [{ kind: 'bot', id: 'bot_b' }] })).toEqual([])
  })

  it('stops bot handoff loops at depth three', () => {
    expect(planTurns({ roomKind: 'group', authorKind: 'bot', botMembers, mentions: [{ kind: 'bot', id: 'bot_a', handoff: true }], handoffDepth: 3 })).toEqual([])
  })

  it('plans direct system turns for named automation bots in list order', () => {
    expect(planTurns({ roomKind: 'group', authorKind: 'system', botMembers, mentions: [], automationBotIds: ['bot_c', 'bot_b'] }))
      .toEqual([{ botId: 'bot_c', replyMode: 'direct', handoffDepth: 0 }, { botId: 'bot_b', replyMode: 'direct', handoffDepth: 0 }])
    expect(planTurns({ roomKind: 'group', authorKind: 'system', botMembers, mentions: [], automationBotIds: ['bot_other'] })).toEqual([])
  })

  it('returns no dm turn if its invariant is broken and no bot exists', () => {
    expect(planTurns({ roomKind: 'dm', authorKind: 'user', botMembers: [], mentions: [] })).toEqual([])
  })
})
