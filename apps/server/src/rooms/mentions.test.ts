import { describe, expect, it } from 'vitest'
import { parseMentions, withinOneEdit } from './mentions.js'

describe('parseMentions', () => {
  const candidates = [
    { kind: 'bot' as const, id: 'bot_ferruccio', name: 'Ferruccio', slug: 'ferruccio' },
    { kind: 'bot' as const, id: 'bot_zach', name: 'Zach', slug: 'zach' },
    { kind: 'bot' as const, id: 'bot_anna', name: 'Anna Maria', slug: 'anna' },
    { kind: 'user' as const, id: 'usr_jc', name: 'Juan Carlos' },
  ]

  it('matches case-insensitively in textual order with longest names first', () => {
    expect(parseMentions('@ANNA MARIA ask @zach and @Juan Carlos', candidates)).toEqual([
      { kind: 'bot', id: 'bot_anna' },
      { kind: 'bot', id: 'bot_zach' },
      { kind: 'user', id: 'usr_jc' },
    ])
  })

  it('merges explicit mentions without duplicates', () => {
    expect(parseMentions('@zach hi', candidates, [{ kind: 'bot', id: 'bot_anna' }, { kind: 'bot', id: 'bot_zach' }]))
      .toEqual([{ kind: 'bot', id: 'bot_zach' }, { kind: 'bot', id: 'bot_anna' }])
  })

  it('matches standalone names and multi-word names in textual order', () => {
    expect(parseMentions('hola ferruccio', candidates)).toEqual([{ kind: 'bot', id: 'bot_ferruccio' }])
    expect(parseMentions('Zach, what do you think?', candidates)).toEqual([{ kind: 'bot', id: 'bot_zach' }])
    expect(parseMentions('anna maria and zach', candidates)).toEqual([
      { kind: 'bot', id: 'bot_anna' },
      { kind: 'bot', id: 'bot_zach' },
    ])
  })

  it('normalizes accents and allows one typo only for longer single-word labels', () => {
    expect(parseMentions('hei ferrucio contesta', candidates)).toEqual([{ kind: 'bot', id: 'bot_ferruccio' }])
    expect(parseMentions('Ferrucció?', candidates)).toEqual([{ kind: 'bot', id: 'bot_ferruccio' }])
    expect(parseMentions('zack, hi', candidates)).toEqual([])
    expect(withinOneEdit('ferruccio', 'ferrucio')).toBe(true)
    expect(withinOneEdit('ferruccio', 'ferruccixo')).toBe(true)
    expect(withinOneEdit('ferruccio', 'ferruzzio')).toBe(false)
  })

  it('does not match longer words or unrelated prose', () => {
    expect(parseMentions('zachary and ferruccioni', candidates)).toEqual([])
    expect(parseMentions('hablen entre ustedes', candidates)).toEqual([])
  })

  it('merges at-name and bare-name hits by textual order and deduplicates them', () => {
    expect(parseMentions('@zach ask ferruccio, then zach again', candidates)).toEqual([
      { kind: 'bot', id: 'bot_zach' },
      { kind: 'bot', id: 'bot_ferruccio' },
    ])
  })
})
