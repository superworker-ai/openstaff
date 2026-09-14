import { expect, it, vi } from 'vitest'
import { ComposioCatalog, CATALOG_REFRESH_MS } from './catalog.js'
import type { ComposioClient, ComposioToolkit, ToolkitPage } from './client.js'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const rows = Array.from({ length: 70 }, (_, index) => ({ slug: `app-${index}`, name: `App ${index}`, description: 'Toolkit' }))
const client = (overrides: Partial<ComposioClient> = {}): ComposioClient => ({ toolkits: async () => rows, connections: async () => [], search: async () => [], metadata: async (slug) => ({ slug, toolkit: 'app', description: '' }), execute: async () => ({}), link: async () => ({ redirectUrl: 'https://example.com' }), ...overrides })

it('serves a searched first toolkits.list page while the full traversal is blocked, then searches from memory', async () => {
  const blocked = deferred<ToolkitPage>()
  const sdk = { toolkits: { list: vi.fn(async ({ cursor, limit, search }: { cursor?: string; limit: number; search?: string }): Promise<ToolkitPage> => {
    if (cursor) return blocked.promise
    const items = rows.filter((row) => !search || row.name.includes(search))
    return { items: items.slice(0, limit), nextCursor: items.length > limit ? 'page-2' : null, total: items.length }
  }) } }
  const catalog = new ComposioCatalog(client({ toolkitPage: sdk.toolkits.list, toolkits: async () => {
    const first = await sdk.toolkits.list({ limit: 24 })
    const second = await sdk.toolkits.list({ limit: 60, cursor: first.nextCursor! })
    return [...first.items, ...second.items]
  } }))
  const build = catalog.refresh()
  const first = await catalog.read('App 1', 24)
  expect(first).toMatchObject({ warming: true, total: 11 })
  expect(first.rows).toHaveLength(11)
  expect(sdk.toolkits.list).toHaveBeenCalledWith({ limit: 24, search: 'App 1' })
  await catalog.read('App 1', 24)
  const calls = sdk.toolkits.list.mock.calls.length
  blocked.resolve({ items: rows.slice(24), nextCursor: null, total: 70 })
  await build
  const ready = await catalog.read('App 2')
  expect(ready).toMatchObject({ warming: false, total: 70 })
  expect(ready.version).not.toBe(first.version)
  expect(sdk.toolkits.list).toHaveBeenCalledTimes(calls)
})

it('deduplicates builds, refreshes after 15 minutes, and retains a usable snapshot after failure', async () => {
  vi.useFakeTimers()
  const build = vi.fn(async () => rows), catalog = new ComposioCatalog(client({ toolkits: build }))
  try {
    await Promise.all([catalog.refresh(), catalog.refresh()])
    expect(build).toHaveBeenCalledOnce()
    const old = await catalog.read()
    build.mockRejectedValueOnce(new Error('offline'))
    vi.advanceTimersByTime(CATALOG_REFRESH_MS)
    const next = await catalog.read()
    expect(next).toMatchObject({ warming: false, version: old.version, rows })
    await catalog.refresh()
    expect(build).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})

it('retries failed first builds without losing the warming signal', async () => {
  vi.useFakeTimers()
  const build = vi.fn<() => Promise<ComposioToolkit[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rows)
  const catalog = new ComposioCatalog(client({ toolkits: build }))
  try {
    await catalog.refresh()
    expect((await catalog.read()).warming).toBe(true)
    vi.advanceTimersByTime(3000)
    await catalog.read()
    await catalog.refresh()
    expect((await catalog.read()).warming).toBe(false)
  } finally { vi.useRealTimers() }
})
