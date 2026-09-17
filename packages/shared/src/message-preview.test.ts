import { describe, expect, it } from 'vitest'
import { plainPreview } from './message-preview.js'

describe('plainPreview', () => {
  it('removes bold markers', () => {
    expect(plainPreview('**Bold** and __strong__')).toBe('Bold and strong')
  })

  it('removes emphasis markers around words', () => {
    expect(plainPreview('*hello* and _world_')).toBe('hello and world')
  })

  it('preserves snake case', () => {
    expect(plainPreview('read snake_case as-is')).toBe('read snake_case as-is')
  })

  it('preserves multiplication', () => {
    expect(plainPreview('2*3 = 6')).toBe('2*3 = 6')
  })

  it('removes inline code and strikethrough markers', () => {
    expect(plainPreview('Use `pnpm test`, not ~~npm test~~.')).toBe('Use pnpm test, not npm test.')
  })

  it('keeps link labels and image alt text', () => {
    expect(plainPreview('[Docs](https://example.com) ![diagram](diagram.png)')).toBe('Docs diagram')
  })

  it('removes block markers at the start of every line', () => {
    expect(plainPreview('# Heading\n> Quote\n- Item\n* Other\n1. First')).toBe('Heading Quote Item Other First')
  })

  it('removes fenced code marker lines and collapses whitespace', () => {
    expect(plainPreview('Before\n```ts\nconst answer = 42\n```\n\nAfter')).toBe('Before const answer = 42 After')
  })

  it('is idempotent', () => {
    const once = plainPreview('> **Update**\n\n- [Details](https://example.com)')
    expect(plainPreview(once)).toBe(once)
  })
})
