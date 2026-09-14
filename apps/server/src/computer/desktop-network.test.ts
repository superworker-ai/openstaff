import { expect, it } from 'vitest'
import { numericHttpEndpoint } from './desktop-network.js'

it('does not rewrite HTTPS or non-private desktop hostnames', async () => {
  const hosted = 'https://9222-sandbox.e2b.app/json/version'
  const unresolved = 'http://desktop-host.invalid:9222/json/version'
  await expect(numericHttpEndpoint(hosted)).resolves.toBe(hosted)
  await expect(numericHttpEndpoint(unresolved)).resolves.toBe(unresolved)
})
