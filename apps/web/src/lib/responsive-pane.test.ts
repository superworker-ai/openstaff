import { describe, expect, it } from 'vitest'
import { responsivePaneOpen } from './responsive-pane'

describe('responsive pane state', () => {
  it('keeps mobile entry focused on the primary content despite a saved desktop preference', () => {
    expect(responsivePaneOpen({ wide: false, stored: 'true', defaultOpen: true })).toBe(false)
  })

  it('honors an explicit request to open a pane on mobile', () => {
    expect(responsivePaneOpen({ wide: false, stored: 'true', defaultOpen: true, requested: true })).toBe(true)
  })

  it('restores desktop preferences and defaults', () => {
    expect(responsivePaneOpen({ wide: true, stored: null, defaultOpen: true })).toBe(true)
    expect(responsivePaneOpen({ wide: true, stored: 'false', defaultOpen: true })).toBe(false)
    expect(responsivePaneOpen({ wide: true, stored: 'true', defaultOpen: false })).toBe(true)
  })
})
