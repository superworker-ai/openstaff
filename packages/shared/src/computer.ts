import { z } from 'zod'

export const COMPUTER_PROVIDERS = ['local', 'docker', 'e2b', 'daytona', 'freestyle', 'vercel'] as const
export type ComputerProviderId = typeof COMPUTER_PROVIDERS[number]

export interface ComputerCapabilities {
  persistent: boolean
  snapshots: boolean
  explicitStop: boolean
  hostFiles: boolean
  desktop: boolean
  volume: boolean
}

export type DesktopInputAction =
  | { type: 'click'; x: number; y: number; button?: 1 | 2 | 3 }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number }

export interface StorageStatus {
  kind: 'fs' | 's3'
  healthy: boolean
  bucket?: string
  fileCount: number
  lastReconcileAt?: string
  lastWarning?: string
}

export const computerLeaseSchema = z.object({
  ownerKind: z.enum(['bot', 'human']),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  epoch: z.number().int().min(0),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  reason: z.string().nullable(),
})
export type ComputerLease = z.infer<typeof computerLeaseSchema>

export interface ComputerStatus {
  provider: ComputerProviderId
  status: 'ready' | 'starting' | 'paused' | 'stopped' | 'error'
  lockedByEnv: boolean
  detail?: string
  error?: string
  instanceId?: string
  lastSeenAt?: string
  desktop?: { kind: 'proxied' | 'external'; stream: boolean; cdp: boolean; template?: string }
  capabilities?: ComputerCapabilities
  lease?: ComputerLease
}

export interface ComputerProviderInfo {
  id: ComputerProviderId
  label: string
  capabilities: ComputerCapabilities
  configured: boolean
  credentialSource: 'settings' | 'env' | null
  managed: boolean
  fields: Array<{ name: string; label: string; secret: boolean; required: boolean; placeholder?: string }>
}

export const computerProviderSchema = z.enum(COMPUTER_PROVIDERS)
