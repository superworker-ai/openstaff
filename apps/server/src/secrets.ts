import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { PROVIDERS, type Provider } from '@openstaff/shared'
import type { Database } from './db/index.js'
import { providerKeys } from './db/schema.js'

export class Secrets {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes encoded as hex or base64')
  }
  static async open(dataDir: string): Promise<Secrets> {
    const configured = process.env.SECRETS_KEY
    if (configured) return new Secrets(Buffer.from(configured, /^[0-9a-f]{64}$/i.test(configured) ? 'hex' : 'base64'))
    const file = path.join(dataDir, 'secrets.key')
    await fs.mkdir(dataDir, { recursive: true })
    try {
      await fs.writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
      console.warn('SECRETS_KEY is unset; generated DATA_DIR/secrets.key. Back up this file with the database.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    return new Secrets(Buffer.from((await fs.readFile(file, 'utf8')).trim(), 'hex'))
  }
  encrypt(plaintext: string, aad?: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv)
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [aad ? 'v2' : 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.')
  }
  decrypt(value: string, aad?: string): string {
    const [version, iv, tag, ciphertext] = value.split('.')
    if ((version !== 'v1' && version !== 'v2') || !iv || !tag || ciphertext === undefined) throw new Error('Invalid encrypted value')
    if ((version === 'v2') !== Boolean(aad)) throw new Error('Invalid encrypted value context')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'))
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }
}

const envNames: Record<Provider, string> = { xai: 'XAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', opencode: 'OPENCODE_API_KEY', composio: 'COMPOSIO_API_KEY', aiGateway: 'AI_GATEWAY_API_KEY', typesafe: 'TYPESAFE_API_KEY' }
export class KeyStore {
  private readonly keys = new Map<Provider, string>()
  constructor(private readonly db: Database, private readonly secrets: Secrets) {}
  async load(): Promise<void> {
    this.keys.clear()
    for (const row of await this.db.select().from(providerKeys)) this.keys.set(row.provider, this.secrets.decrypt(row.encryptedKey))
  }
  get(provider: Provider): string | undefined { return this.keys.get(provider) || process.env[envNames[provider]] || undefined }
  /** Distinguishes a saved key from the environment fallback without revealing either. */
  source(provider: Provider): 'settings' | 'env' | null {
    if (this.keys.get(provider)) return 'settings'
    return process.env[envNames[provider]] ? 'env' : null
  }
  configured(): Record<Provider, boolean> { return Object.fromEntries(PROVIDERS.map((provider) => [provider, Boolean(this.get(provider))])) as Record<Provider, boolean> }
  async set(values: Partial<Record<Provider, string>>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const provider of PROVIDERS) {
        const value = values[provider]
        if (value === undefined) continue
        if (!value) await tx.delete(providerKeys).where(eq(providerKeys.provider, provider))
        else await tx.insert(providerKeys).values({ provider, encryptedKey: this.secrets.encrypt(value) }).onConflictDoUpdate({ target: providerKeys.provider, set: { encryptedKey: this.secrets.encrypt(value) } })
      }
    })
    await this.load()
  }
}
