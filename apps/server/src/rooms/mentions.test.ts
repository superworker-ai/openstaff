import { describe, expect, it } from 'vitest'
import { parseMentions } from './mentions.js'

describe('parseMentions', () => {
  const candidates = [
    { kind: 'bot' as const, id: 'bot_ann', name: 'Ann', slug: 'ann' },
    { kind: 'bot' as const, id: 'bot_anna', name: 'Anna Maria', slug: 'anna' },
    { kind: 'user' as const, id: 'usr_jc', name: 'Juan Carlos' },
  ]

  it('matches case-insensitively in textual order with longest names first', () => {
    expect(parseMentions('@ANNA MARIA ask @ann and @Juan Carlos', candidates)).toEqual([
      { kind: 'bot', id: 'bot_anna' },
      { kind: 'bot', id: 'bot_ann' },
      { kind: 'user', id: 'usr_jc' },
    ])
  })

  it('merges explicit mentions without duplicates', () => {
    expect(parseMentions('@ann hi', candidates, [{ kind: 'bot', id: 'bot_anna' }, { kind: 'bot', id: 'bot_ann' }]))
      .toEqual([{ kind: 'bot', id: 'bot_ann' }, { kind: 'bot', id: 'bot_anna' }])
  })
})
