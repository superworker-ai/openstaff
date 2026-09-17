import { Composio, type AuthSchemeType, type CreateAuthConfigParams } from '@composio/core'

export interface ComposioTool { slug: string; toolkit: string; description: string; tags?: string[]; version?: string }
export interface ComposioConnection { id: string; toolkit: string; status: string; createdAt: string }
export interface ComposioToolkit { slug: string; name: string; description: string; logo?: string; aliases?: string[] }
export interface ToolkitPage { items: ComposioToolkit[]; nextCursor: string | null; total: number }
export interface ComposioClient {
  connections(): Promise<ComposioConnection[]>
  search(query: string, toolkits?: string[]): Promise<ComposioTool[]>
  metadata(slug: string): Promise<ComposioTool>
  execute(slug: string, args: Record<string, unknown>, version?: string): Promise<unknown>
  link(toolkit: string, callbackUrl?: string): Promise<{ redirectUrl: string }>
  disconnect?(id: string): Promise<unknown>
  toolkits(): Promise<ComposioToolkit[]>
  toolkitPage?(query: { cursor?: string; limit: number; search?: string }): Promise<ToolkitPage>
}
// Core's convenience toolkits.get() drops pagination metadata. Its typed underlying
// client preserves the cursor so the marketplace can cover the whole catalog.
class WorkspaceComposio extends Composio {
  async catalogPage(query: { cursor?: string; limit: number; search?: string }): Promise<ToolkitPage> {
    const page = await this.client.toolkits.list(query, { signal: AbortSignal.timeout(20_000) })
    return { items: page.items.map((item) => ({ slug: item.slug, name: item.name, description: item.meta.description, logo: item.meta.logo })), nextCursor: page.next_cursor ?? null, total: page.total_items }
  }
  async catalog(): Promise<ComposioToolkit[]> {
    const rows: ComposioToolkit[] = []
    let cursor: string | undefined
    do {
      const page = await this.catalogPage({ limit: 100, cursor })
      rows.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return rows
  }
}
export function createComposioClient(apiKey: string, dataDir: string, userId: string): ComposioClient {
  const sdk = new WorkspaceComposio({ apiKey, allowTracking: false, fileUploadDirs: false, fileDownloadDir: `${dataDir}/downloads` })
  const request = () => ({ signal: AbortSignal.timeout(20_000) })
  const normalize = (tool: { slug: string; description?: string; toolkit?: { slug: string }; tags?: string[]; version?: string }): ComposioTool => ({ slug: tool.slug, toolkit: tool.toolkit?.slug ?? tool.slug.split('_')[0]!.toLowerCase(), description: tool.description ?? '', tags: tool.tags, version: tool.version })
  // Composio only ships managed OAuth for some toolkits. The rest (1Password, most API-key
  // apps) need a workspace-owned auth config; with an empty credential set Composio's hosted
  // connect page collects the key from the person linking, so the popup flow stays the same.
  const authConfigParams = async (toolkit: string): Promise<CreateAuthConfigParams> => {
    const info = await sdk.toolkits.get(toolkit, request())
    if (info.composioManagedAuthSchemes?.length) return { type: 'use_composio_managed_auth' }
    const scheme = info.authConfigDetails?.map((detail) => detail.mode).find((mode) => mode !== 'OAUTH2' && mode !== 'OAUTH1')
    if (!scheme) throw new Error(`${info.name} needs your own OAuth client: create an auth config for it at platform.composio.dev, then connect again`)
    return { type: 'use_custom_auth', authScheme: scheme as AuthSchemeType, credentials: {} }
  }
  return {
    async connections() {
      const result: ComposioConnection[] = []
      let cursor: string | undefined
      do {
        const page = await sdk.connectedAccounts.list({ userIds: [userId], limit: 100, cursor }, request())
        result.push(...page.items.map((account) => ({ id: account.id, toolkit: account.toolkit.slug, status: account.isDisabled ? 'DISABLED' : account.status, createdAt: account.createdAt })))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return result
    },
    async search(query, toolkits) { return (await sdk.tools.getRawComposioTools(toolkits ? { search: query, toolkits, limit: 10 } : { search: query }, undefined, request())).slice(0, 10).map(normalize) },
    async metadata(slug) { return normalize(await sdk.tools.getRawComposioToolBySlug(slug, undefined, request())) },
    async execute(slug, args, version) {
      return sdk.tools.execute(slug, { userId, arguments: args, ...(version ? { version } : { dangerouslySkipVersionCheck: true }) }, request())
    },
    async link(toolkit, callbackUrl) {
      const configs = await sdk.authConfigs.list({ toolkit, showDisabled: false }, request())
      const auth = configs.items[0] ?? await sdk.authConfigs.create(toolkit, await authConfigParams(toolkit), request())
      const result = await sdk.connectedAccounts.link(userId, auth.id, { callbackUrl }, request())
      if (!result.redirectUrl) throw new Error('Composio did not provide a connection URL')
      return { redirectUrl: result.redirectUrl }
    },
    toolkits: () => sdk.catalog(),
    toolkitPage: (query) => sdk.catalogPage(query),
    disconnect: (id) => sdk.connectedAccounts.delete(id, request()),
  }
}
