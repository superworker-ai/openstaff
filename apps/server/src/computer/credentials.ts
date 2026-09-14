import { eq } from 'drizzle-orm'
import type { ComputerProviderId } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { computerCredentials } from '../db/schema.js'
import type { Secrets } from '../secrets.js'

export interface ResolvedCredentials { values: Record<string, string>; source: 'settings' | 'env' | null }

const environment: Record<ComputerProviderId, Record<string, string>> = {
  local: {}, docker: {}, e2b: { apiKey: 'E2B_API_KEY' }, daytona: { apiKey: 'DAYTONA_API_KEY', apiUrl: 'DAYTONA_API_URL', target: 'DAYTONA_TARGET' },
  freestyle: { apiKey: 'FREESTYLE_API_KEY', baseUrl: 'FREESTYLE_BASE_URL' },
  vercel: { token: 'VERCEL_TOKEN', teamId: 'VERCEL_TEAM_ID', projectId: 'VERCEL_PROJECT_ID' },
}

export class ComputerCredentials {
  constructor(private readonly db: Database, private readonly secrets: Secrets) {}
  async resolve(provider: ComputerProviderId): Promise<ResolvedCredentials> {
    const saved = (await this.db.select().from(computerCredentials).where(eq(computerCredentials.provider, provider)).limit(1))[0]
    if (saved) return { values: JSON.parse(this.secrets.decrypt(saved.encrypted, `computer:${provider}`)) as Record<string, string>, source: 'settings' }
    const values = Object.fromEntries(Object.entries(environment[provider]).flatMap(([field, name]) => process.env[name] ? [[field, process.env[name]!]] : []))
    return { values, source: Object.keys(values).length ? 'env' : null }
  }
  async set(provider: ComputerProviderId, values: Record<string, string>, updatedBy?: string): Promise<void> {
    const now = new Date().toISOString(), encrypted = this.secrets.encrypt(JSON.stringify(values), `computer:${provider}`)
    await this.db.insert(computerCredentials).values({ provider, encrypted, updatedAt: now, updatedBy: updatedBy ?? null }).onConflictDoUpdate({ target: computerCredentials.provider, set: { encrypted, updatedAt: now, updatedBy: updatedBy ?? null } })
  }
  async clear(provider: ComputerProviderId): Promise<void> { await this.db.delete(computerCredentials).where(eq(computerCredentials.provider, provider)) }
}
