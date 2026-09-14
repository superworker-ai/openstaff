import { expect, it, vi } from 'vitest'
import * as clients from './client.js'
import { ComposioService } from './service.js'
import { fixture } from '../test/fixture.js'
import { marketplaceClient, toolkitRows } from '../test/marketplace-fixtures.js'
import { CATALOG_REFRESH_MS } from './catalog.js'

it('warms at boot and key rotation, discards old-key builds, refreshes every 15 minutes and stops its timer', async () => {
  const f = await fixture()
  let key: string | undefined = 'first', finish!: (rows: typeof toolkitRows) => void
  const first = marketplaceClient(), second = marketplaceClient()
  first.toolkits = vi.fn(() => new Promise<typeof toolkitRows>((resolve) => { finish = resolve }))
  const factory = vi.spyOn(clients, 'createComposioClient').mockImplementation((key) => key === 'first' ? first : second)
  const service = new ComposioService(f.db, f.admission, { get: () => key }, f.directory)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  try {
    service.start()
    expect(first.toolkits).toHaveBeenCalledOnce()
    key = 'second'; service.refreshCatalog()
    await Promise.resolve()
    expect(second.toolkits).toHaveBeenCalledOnce()
    finish([])
    await Promise.resolve()
    expect((await service.catalogPage()).total).toBe(70)
    expect(factory).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS)
    expect(second.toolkits).toHaveBeenCalledTimes(2)
    key = undefined; service.refreshCatalog()
    expect(await service.catalogPage()).toMatchObject({ configured: false, warming: false, toolkits: [] })
    service.stop()
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS)
    expect(second.toolkits).toHaveBeenCalledTimes(2)
  } finally { service.stop(); vi.useRealTimers(); factory.mockRestore(); await f.close() }
})
