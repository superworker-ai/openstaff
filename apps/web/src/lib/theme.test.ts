import { describe, expect, it, vi } from 'vitest'
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, readPreference, resolveTheme } from './theme'

vi.mock('react', () => ({ useSyncExternalStore: vi.fn() }))

describe('resolveTheme', () => {
  it('keeps explicit preferences', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('resolves system from the media preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('readPreference', () => {
  it.each(['light', 'dark', 'system'] as const)('accepts %s', (value) => {
    expect(readPreference({ getItem: () => value })).toBe(value)
  })

  it.each([null, '', 'sepia', 'DARK'])('falls back to system for %j', (value) => {
    expect(readPreference({ getItem: () => value })).toBe('system')
  })

  it('falls back to system when storage is missing or unavailable', () => {
    expect(readPreference(undefined)).toBe('system')
    expect(readPreference({ getItem: () => { throw new Error('blocked') } })).toBe('system')
  })
})

describe('THEME_BOOT_SCRIPT', () => {
  it('sets a stored light theme synchronously', () => {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
    const fakeWindow = {
      localStorage: { getItem: (key: string) => key === THEME_STORAGE_KEY ? 'light' : null },
      matchMedia: () => ({ matches: true }),
    }
    const fakeDocument = { documentElement: root }

    new Function('window', 'document', THEME_BOOT_SCRIPT)(fakeWindow, fakeDocument)

    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
