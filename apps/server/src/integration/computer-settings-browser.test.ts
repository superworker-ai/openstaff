import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { browserHarness, createAgent, signUp } from '../test/browser-harness.js'
import { computerProvider, registerComputerProvider } from '../computer/registry.js'

describe.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('Computer Settings browser flow', () => {
  it('shows provider cards and saves/tests a mocked provider', async () => {
    const original = computerProvider('e2b')
    const validate = vi.fn(async () => {})
    registerComputerProvider({ id: 'e2b', label: 'Mock E2B', capabilities: { persistent: true, snapshots: true, explicitStop: true, hostFiles: false, desktop: false, volume: true }, credentialSchema: z.object({ apiKey: z.string().min(1) }), fields: [{ name: 'apiKey', label: 'Mock E2B key', secret: true, required: true }], validateCredentials: validate, async open() { throw new Error('Not selected in this test') } })
    vi.stubEnv('COMPUTER_DRIVER', '')
    const h = await browserHarness()
    try {
      await signUp(h, { name: 'Computer Owner', email: 'computer-settings@example.test' })
      await createAgent(h, 'Computer Bot', { template: 'Engineer' })
      await h.page.getByRole('link', { name: 'Settings', exact: true }).click()
      await h.page.getByRole('heading', { name: 'Workspace settings', exact: true }).waitFor()
      await h.page.getByRole('link', { name: 'Computer', exact: true }).click()
      await h.page.getByRole('heading', { name: 'Computer', exact: true }).waitFor()
      await h.page.getByTestId('storage-row').getByText(/Filesystem/).waitFor()
      await h.page.getByRole('button', { name: /^Mock E2B/ }).click()
      await h.page.getByLabel('Mock E2B key').fill('browser-canary')
      await h.page.getByRole('button', { name: 'Test connection', exact: true }).click()
      await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1))
      await h.page.getByRole('button', { name: 'Save', exact: true }).click()
      await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2))
      const directory = path.resolve('.context/screenshots')
      await fs.mkdir(directory, { recursive: true })
      await h.page.screenshot({ path: path.join(directory, 'phase6.1-storage.png'), fullPage: true })
    } finally { await h.stop(); vi.unstubAllEnvs(); registerComputerProvider(original) }
  }, 90_000)
})
