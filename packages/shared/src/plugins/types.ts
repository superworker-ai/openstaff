export interface VariableSchema {
  type: 'object'
  properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown; [key: string]: unknown }>
  required?: string[]
  [key: string]: unknown
}
export interface PluginManifest {
  name: string
  displayName?: string
  description?: string
  version?: string
  minClientVersions?: Record<string, string>
  author?: { name: string; email?: string }
  publisher?: string
  homepage?: string
  repository?: string
  license?: string
  logo?: string
  keywords?: string[]
  category?: string
  tags?: string[]
  commands?: string | string[]
  agents?: string | string[]
  skills?: string | string[]
  rules?: string | string[]
  hooks?: string | Record<string, unknown>
  variables?: VariableSchema
  mcpServers?: string | Record<string, unknown> | Array<string | Record<string, unknown>>
}
export interface MarketplaceEntry { name: string; source: string; description?: string; minClientVersions?: Record<string, string> }
export interface PluginMarketplace {
  name: string
  owner?: { name: string; email?: string }
  metadata?: Record<string, unknown>
  plugins: MarketplaceEntry[]
}

export interface ServerAuthDescription {
  protected: boolean
  authorizationServer: string | null
  scopes: string[]
  supportsDynamicRegistration: boolean
}
export interface PluginServerAuth extends ServerAuthDescription {
  lastCheckedAt?: string | null
  refreshError?: string | null
  auth?: 'none' | 'dcr' | 'manual-client' | 'unknown'
  issuer?: string | null
  error?: string | null
  status?: 'Connected' | 'Expired' | 'Error' | 'Not connected'
  name: string
  url: string
  connected: boolean
  needsClientCredentials: boolean
  redirectUri: string
}
export interface PluginOAuthAuthorizationServer {
  issuer?: string
  authorizationServerUrl: string
  tokenEndpoint: string
}

/** Database representation; encrypted values never belong in public API responses. */
export interface PluginOAuthRecord {
  pluginId: string
  serverName: string
  clientInformation: string | null
  tokens: string | null
  codeVerifier: string | null
  state: string | null
  authorizationServer: PluginOAuthAuthorizationServer | null
  scopes: string[] | null
  updatedAt: string
}
