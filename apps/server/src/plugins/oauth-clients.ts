import { eq } from 'drizzle-orm'
import type { OAuthClientInformation } from '@ai-sdk/mcp'
import type { Database } from '../db/index.js'
import { oauthClients } from '../db/schema.js'
import type { Secrets } from '../secrets.js'

export class OAuthClients {
  constructor(private readonly db: Database, private readonly secrets: Secrets) {}
  async get(issuer: string): Promise<OAuthClientInformation | undefined> {
    const row = (await this.db.select().from(oauthClients).where(eq(oauthClients.issuer, issuer.replace(/\/$/, ''))))[0]
    return row ? { client_id: row.clientId, ...(row.clientSecret ? { client_secret: this.secrets.decrypt(row.clientSecret) } : {}) } : undefined
  }
  async save(issuer: string, client: OAuthClientInformation) {
    const values = { issuer: issuer.replace(/\/$/, ''), clientId: client.client_id, clientSecret: client.client_secret ? this.secrets.encrypt(client.client_secret) : null }
    await this.db.insert(oauthClients).values(values).onConflictDoUpdate({ target: oauthClients.issuer, set: values })
  }
  async list() { return this.db.select({ issuer: oauthClients.issuer, clientId: oauthClients.clientId }).from(oauthClients) }
  async forget(issuer: string) { await this.db.delete(oauthClients).where(eq(oauthClients.issuer, issuer.replace(/\/$/, ''))) }
}
