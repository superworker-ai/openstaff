import { expect, it } from 'vitest'
import type { MarketplaceApp } from '@openstaff/shared'
import { clampLimit, decodeCursor, encodeCursor, normalizeQuery, paginate, searchApps, searchSkills } from './pagination.js'

const app = (name: string, extra: Partial<MarketplaceApp> = {}): MarketplaceApp => ({ name, slug: name.toLowerCase(), description: '', aliases: [], status: 'Available', toolkit: name, plugins: [], ...extra })

it('round-trips opaque pagination cursors and recomputes the next page', () => {
  const rows = Array.from({ length: 70 }, (_, index) => index)
  const first = paginate(rows, '', 'v1', 24)
  expect(first.items).toHaveLength(24)
  expect(decodeCursor(first.nextCursor!, '', 'v1')).toBe(24)
  const second = paginate(rows, '', 'v1', 24, first.nextCursor!)
  expect(second.items).toEqual(rows.slice(24, 48))
  expect(paginate(rows, '', 'v1', 24, second.nextCursor!).nextCursor).toBeNull()
})

it('restarts stale, changed-query, malformed and out-of-range cursors at zero', () => {
  const rows = Array.from({ length: 70 }, (_, index) => index)
  for (const cursor of [encodeCursor(24, '', 'old'), encodeCursor(24, 'other', 'v2'), 'garbage', encodeCursor(-1, '', 'v2'), encodeCursor(1.5, '', 'v2'), encodeCursor(900, '', 'v2')]) {
    const page = paginate(rows, '', 'v2', 24, cursor)
    expect(page.items[0]).toBe(0)
    expect(decodeCursor(page.nextCursor!, '', 'v2')).toBe(24)
  }
})

it('clamps page limits to 1–60 with a default of 24', () => {
  expect([undefined, '24', '999', '-3', '0', '3.9', 'invalid', 'Infinity'].map(clampLimit)).toEqual([24, 24, 60, 1, 1, 3, 24, 24])
  expect(normalizeQuery('  MaIL  ')).toBe('mail')
})

it('ranks name prefix, name or slug substring, alias, description, then status and alphabetically', () => {
  const rows = [app('Zulu', { description: 'MAIL', status: 'Connected' }), app('Alias', { aliases: ['mail'] }), app('My Mail'), app('Mail Z'), app('Mail B', { status: 'Connected' }), app('Mail A', { status: 'Connected' }), app('Mail C', { status: 'Expired' }), app('Mail D', { plugins: [{ name: 'p', id: 'installed' }] }), app('Unrelated'), app('Slug', { slug: 'my-mail' })]
  expect(searchApps(rows, 'mail').map((row) => row.name)).toEqual(['Mail A', 'Mail B', 'Mail C', 'Mail D', 'Mail Z', 'My Mail', 'Slug', 'Alias', 'Zulu'])
  expect(searchApps(rows, '').slice(0, 5).map((row) => row.name)).toEqual(['Mail A', 'Mail B', 'Zulu', 'Mail C', 'Mail D'])
})

it('searches skill names, display names and descriptions with installed flags intact', () => {
  const skills = [{ name: 'alpha', source: './alpha', installed: false, description: 'Review code' }, { name: 'beta', source: './beta', installed: true, manifest: { name: 'beta', displayName: 'Code helper', description: 'Write tests' } }]
  expect(searchSkills(skills, 'code').map((skill) => skill.name)).toEqual(['beta', 'alpha'])
  expect(searchSkills(skills, 'tests')[0]?.installed).toBe(true)
  expect(searchSkills(skills, 'alpha')).toHaveLength(1)
})
