import type { ComputerCapabilities, ComputerProviderId, ComputerProviderInfo, JsonValue } from '@openstaff/shared'
import { z } from 'zod'
import type { ManagedComputer } from './types.js'

export interface ComputerInstanceRecord {
  id: string
  provider: ComputerProviderId
  externalId: string
  status: string
  createdAt: string
  lastSeenAt: string
  metadata: Record<string, JsonValue>
}

export interface ComputerProvider {
  readonly id: ComputerProviderId
  readonly label: string
  readonly capabilities: ComputerCapabilities
  readonly credentialSchema: z.ZodType<Record<string, string>>
  readonly fields: ComputerProviderInfo['fields']
  validateCredentials(credentials: Record<string, string>): Promise<void>
  open(input: { credentials: Record<string, string>; workspaceRoot: string; instanceId: string; instance: ComputerInstanceRecord | null; persist: (patch: Partial<ComputerInstanceRecord> & Pick<ComputerInstanceRecord, 'externalId' | 'status'>) => Promise<void> }): Promise<ManagedComputer>
}

export class ComputerError extends Error {
  constructor(readonly kind: 'auth' | 'transient' | 'permanent' | 'unavailable', message: string) { super(message) }
}

export function providerError(provider: string, error: unknown, credential = 'API key'): ComputerError {
  if (error instanceof ComputerError) return error
  const value = error as { status?: number; statusCode?: number; response?: { status?: number } }
  const status = value?.status ?? value?.statusCode ?? value?.response?.status
  if (status === 401 || status === 403) return new ComputerError('auth', `${provider} rejected the configured ${credential}`)
  if (status === 404) return new ComputerError('permanent', `${provider} computer no longer exists`)
  if (status === 429 || (typeof status === 'number' && status >= 500)) return new ComputerError('transient', `${provider} is temporarily unavailable`)
  const reason = error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : ''
  return new ComputerError('unavailable', reason ? `${provider} connection failed: ${reason}` : `${provider} connection failed`)
}
