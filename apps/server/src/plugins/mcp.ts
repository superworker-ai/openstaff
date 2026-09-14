import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { AppConnection } from '@openstaff/shared'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { ToolSet } from 'ai'
import type { LoadedPlugin } from './loader.js'
import type { PluginOAuthService, PluginOAuthProvider } from './oauth.js'
import type { MCPClientPool } from './mcp-pool.js'
import { ConnectionRequiredError } from '../agent/connections.js'

export function namespaceTools(plugin: string, tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => [`${plugin}__${name}`, definition]))
}
export function authFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'UnauthorizedError' || ('statusCode' in error && [401, 403].includes(Number(error.statusCode))) || ('status' in error && [401, 403].includes(Number(error.status))) || /\b40[13]\b|does not support dynamic client registration/.test(error.message) || (error.cause !== error && authFailure(error.cause))
}
export async function openPluginTools(plugins: LoadedPlugin[], signal?: AbortSignal, pool?: MCPClientPool, oauth?: PluginOAuthService) {
  const clients: MCPClient[] = [], tools: ToolSet = {}, readOnly = new Set<string>()
  const hiddenApps = new Set<string>()
  const connections = new Map<string, { provider: PluginOAuthProvider; connection: AppConnection }>()
  for (const plugin of plugins) for (const [serverName, config] of Object.entries(plugin.servers)) {
    let client: MCPClient | undefined, provider: PluginOAuthProvider | undefined
    const key = `${plugin.manifest.name}/${serverName}`, pooled = config.type === 'stdio' && pool
    const connection = (provider: PluginOAuthProvider): AppConnection => ({ source: 'mcp', pluginId: provider.pluginId, serverName, appName: plugin.manifest.displayName ?? serverName })
    try {
      if (plugin.missingVariables.length) { hiddenApps.add(plugin.manifest.displayName ?? plugin.manifest.name); continue }
      if (config.type !== 'stdio') provider = await oauth?.forRuntime(plugin.manifest.name, serverName, config.url)
      if (provider && ((await provider.row())?.refreshError || provider.description.protected && !await provider.ensureConnected())) { hiddenApps.add(connection(provider).appName); continue }
      const transport = config.type === 'stdio' ? new Experimental_StdioMCPTransport({
        command: '/usr/bin/env', cwd: plugin.root,
        args: ['-i', ...Object.entries({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: plugin.root, TERM: 'dumb', ...config.env }).map(([key, value]) => `${key}=${value}`), config.command, ...config.args],
        stderr: 'ignore',
      }) : { ...config, ...(provider ? { authProvider: provider } : {}) }
      const create = (invalidate: () => void) => createMCPClient({ transport, initializationOptions: { timeout: 10_000, signal }, onUncaughtError: () => { invalidate(); console.warn(`MCP ${key}: connection error`) } })
      client = pooled ? await pool.acquire(key, create) : await create(() => undefined)
      const definitions = await client.listTools({ options: { timeout: 10_000, signal } })
      for (const [name, definition] of Object.entries(namespaceTools(plugin.manifest.name, client.toolsFromDefinitions(definitions)))) {
        if (tools[name]) continue
        const execute = definition.execute, authProvider = provider
        if (authProvider?.description.protected) connections.set(name, { provider: authProvider, connection: connection(authProvider) })
        definition.description = `${definition.description ?? ''}${authProvider?.description.protected ? `\nconnected: ${await authProvider.connected()}` : ''}`
        tools[name] = execute ? { ...definition, execute: async (input, options) => {
            if (authProvider?.description.protected && !await authProvider.ensureConnected()) throw new ConnectionRequiredError(connection(authProvider))
            try { return await execute(input, options) }
            catch (error) {
              if (!authProvider || !authFailure(error)) throw error
              await authProvider.markExpired('Your sign-in expired. Reconnect to continue.')
              throw new ConnectionRequiredError(connection(authProvider))
            }
          } } : definition
        if (definitions.tools.find((item) => `${plugin.manifest.name}__${item.name}` === name)?.annotations?.readOnlyHint === true) readOnly.add(name)
      }
      if (!pooled) clients.push(client)
    } catch (error) {
      hiddenApps.add(plugin.manifest.displayName ?? serverName)
      if (provider && authFailure(error)) await provider.invalidateCredentials('tokens')
      if (pooled) await pool.invalidate(key)
      else await client?.close().catch(() => undefined)
      console.warn(`MCP ${key} unavailable; request_connection can connect it`)
    }
  }
  return { tools, readOnly, hiddenApps: [...hiddenApps], missingConnection: async (name: string) => {
    const entry = connections.get(name)
    return entry && !await entry.provider.ensureConnected() ? entry.connection : undefined
  }, close: async () => { await Promise.allSettled(clients.map((client) => client.close())) } }
}
