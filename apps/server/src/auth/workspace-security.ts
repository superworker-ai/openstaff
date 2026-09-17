import { eq } from 'drizzle-orm'
import type { JsonValue } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { workspace } from '../db/schema.js'

export interface WorkspaceAuthSettings {
  ssoOnly: boolean
  requireTwoFactor: boolean
}

export const defaultWorkspaceAuthSettings: WorkspaceAuthSettings = { ssoOnly: false, requireTwoFactor: false }

function object(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined
}

export function workspaceAuthSettings(settings: Record<string, JsonValue> | undefined): WorkspaceAuthSettings {
  const auth = object(settings?.auth)
  return {
    ssoOnly: typeof auth?.ssoOnly === 'boolean' ? auth.ssoOnly : false,
    requireTwoFactor: typeof auth?.requireTwoFactor === 'boolean' ? auth.requireTwoFactor : false,
  }
}

export async function readWorkspaceAuthSettings(db: Database): Promise<WorkspaceAuthSettings> {
  const row = (await db.select({ settings: workspace.settings }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
  return workspaceAuthSettings(row?.settings)
}
