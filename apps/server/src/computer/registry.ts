import { COMPUTER_PROVIDERS, type ComputerProviderId } from '@openstaff/shared'
import { daytonaProvider } from './daytona.js'
import { dockerProvider } from './docker-provider.js'
import { e2bProvider } from './e2b.js'
import { fakeProvider } from './fake.js'
import { freestyleProvider } from './freestyle.js'
import { localProvider } from './local-provider.js'
import { vercelProvider } from './vercel.js'
import type { ComputerProvider } from './provider.js'

const providers = new Map<ComputerProviderId, ComputerProvider>([
  ['local', localProvider], ['docker', dockerProvider], ['e2b', e2bProvider], ['daytona', daytonaProvider], ['freestyle', freestyleProvider], ['vercel', vercelProvider],
])

// Application fixtures must never provision infrastructure inherited from .env.
// Gated live contracts import adapters directly; unit tests can register stubs.
if (process.env.NODE_ENV === 'test') {
  for (const [id, provider] of providers) providers.set(id, {
    ...fakeProvider, id, label: provider.label,
    // Keep credential forms/schema realistic without calling vendor APIs.
    fields: provider.fields, credentialSchema: provider.credentialSchema,
    async open(input) {
      const computer = await fakeProvider.open(input), status = computer.status.bind(computer)
      computer.status = async () => ({ ...await status(), provider: id })
      return computer
    },
  })
} else if (process.env.COMPUTER_ALLOW_FAKE === '1') providers.set('local', fakeProvider)

export function computerProvider(id: ComputerProviderId): ComputerProvider {
  const provider = providers.get(id)
  if (!provider) throw new Error(`Unknown Computer provider: ${id}`)
  return provider
}

export function computerProviders(): ComputerProvider[] { return COMPUTER_PROVIDERS.map(computerProvider) }

export function registerComputerProvider(provider: ComputerProvider): void { providers.set(provider.id, provider) }
