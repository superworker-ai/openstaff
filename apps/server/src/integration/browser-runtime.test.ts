import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { browserSmoke } from '../test/browser-smoke.js'

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('runs browser tools inside a real server turn and protects screenshot access', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-browser-turn-'))
  try { const result = await browserSmoke(directory); expect(result.turn.status).toBe('done'); expect(result.bytes).toBeGreaterThan(1000); expect(result.screenshotCount).toBe(2) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}, 40_000)
