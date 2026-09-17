export interface AppConnection {
  source: 'mcp' | 'composio'
  pluginId?: string
  serverName?: string
  toolkit?: string
  appName: string
  connectUrl?: string
}

export interface ConnectedApp extends AppConnection {
  slug: string
  status: 'connected' | 'expired' | 'not connected'
  logo?: string
  lastCheckedAt?: string | null
  error?: string | null
}

export const suggestedApps: Record<string, string[]> = { research: ['google-drive', 'notion'], growth: ['gmail', 'hubspot', 'google-sheets'], engineer: ['github', 'slack'], ops: ['google-calendar', 'gmail', 'todoist'], custom: [] }
export const knownApps = ['gmail', 'googledrive', 'googlecalendar', 'googlesheets', 'notion', 'hubspot', 'github', 'slack', 'todoist']

const aliases: Record<string, string> = { 'google-mail': 'gmail', 'google-gmail': 'gmail', 'google-drive': 'googledrive', drive: 'googledrive', 'google-calendar': 'googlecalendar', calendar: 'googlecalendar', 'google-docs': 'googledocs', 'google-sheets': 'googlesheets', 'github-mcp': 'github', 'slack-mcp': 'slack' }
export function appAliases(slug: string): string[] { return Object.keys(aliases).filter((alias) => aliases[alias] === appSlug(slug)) }
export function appSlug(name: string): string {
  const normalized = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return aliases[normalized] ?? normalized
}
export function appName(name: string): string {
  const names: Record<string, string> = { gmail: 'Gmail', googledrive: 'Google Drive', googlecalendar: 'Google Calendar', googlesheets: 'Google Sheets', notion: 'Notion', hubspot: 'HubSpot', github: 'GitHub', slack: 'Slack', todoist: 'Todoist' }
  return names[appSlug(name)] ?? name
}
export function connectionPath(connection: AppConnection, approval?: string): string {
  const path = connection.source === 'mcp' ? `/connect/${encodeURIComponent(connection.pluginId!)}/${encodeURIComponent(connection.serverName!)}` : '/api/connections/start'
  const query = new URLSearchParams(approval ? { approval } : {})
  if (connection.toolkit) query.set('toolkit', connection.toolkit)
  return `${path}${query.size ? `?${query}` : ''}`
}
export function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('redirect_uri_mismatch')) return 'Add exactly this redirect URI to the OAuth client'
  if (message.includes('invalid_client') || (error instanceof Error && 'errorCode' in error.constructor && error.constructor.errorCode === 'invalid_client')) return 'Client ID or secret is wrong'
  if (message.includes('access_denied')) return 'You declined the consent screen'
  if (/not active yet/i.test(message)) return 'Sign-in did not finish. Try connecting again.'
  if (message.includes('DefaultAuthConfigNotFound') || message.includes('Default auth config not found')) return 'Composio has no managed sign-in for this app. Create an auth config for it at platform.composio.dev, then connect again.'
  return message
}
