import fs from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import matter from 'gray-matter'
import type { PluginManifest } from '@openstaff/shared'
import { loadManifest, pluginFile, readPluginFile } from './manifest.js'

export interface Component {
  name: string; description: string; body: string; path: string; frontmatter: Record<string, unknown>
}
export type McpServer = { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers: Record<string, string> }
export interface LoadedPlugin {
  root: string; manifest: PluginManifest; skills: Component[]; rules: Component[]; agents: Component[]
  servers: Record<string, McpServer>; missingVariables: string[]; hooks: { supported: false; config: unknown } | null
}

export function interpolate(value: unknown, variables: Record<string, unknown>, missing = new Set<string>(), useEnvironment = true): unknown {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (original, name: string) => {
    const replacement = variables[name] ?? (useEnvironment ? process.env[`PLUGIN_ENV_${name}`] : undefined)
    if (replacement === undefined) { missing.add(name); return original }
    return typeof replacement === 'string' ? replacement : JSON.stringify(replacement)
  })
  if (Array.isArray(value)) return value.map((item) => interpolate(item, variables, missing, useEnvironment))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables, missing, useEnvironment)]))
  return value
}
async function components(root: string, selected: string | string[] | undefined, kind: 'skills' | 'rules' | 'agents'): Promise<Component[]> {
  const patterns: string[] = []
  for (const value of selected === undefined ? [kind] : Array.isArray(selected) ? selected : [selected]) {
    if (path.isAbsolute(value) || value.split('/').includes('..')) throw new Error('Component paths must stay inside the plugin')
    const full = path.resolve(root, value)
    const stat = await fs.stat(full).catch(() => null)
    patterns.push(stat?.isDirectory() ? `${value.replace(/\/$/, '')}/**/${kind === 'skills' ? 'SKILL.md' : '*.{md,mdc}'}` : value)
  }
  const matches = await fg(patterns, { cwd: root, onlyFiles: false, followSymbolicLinks: false, unique: true })
  const discovered = await Promise.all(matches.map(async (file) => {
    const resolved = await pluginFile(root, file)
    if ((await fs.stat(resolved)).isDirectory()) return fg(`${file}/**/${kind === 'skills' ? 'SKILL.md' : '*.{md,mdc}'}`, { cwd: root, onlyFiles: true, followSymbolicLinks: false })
    return [file]
  }))
  const files = [...new Set(discovered.flat())]
  return Promise.all(files.sort().map(async (file) => {
    const parsed = matter(await readPluginFile(root, file))
    const frontmatter: Record<string, unknown> = parsed.data
    return { path: file, name: String(frontmatter.name ?? (kind === 'skills' ? path.basename(path.dirname(file)) : path.basename(file, path.extname(file)))), description: String(frontmatter.description ?? ''), body: parsed.content, frontmatter }
  }))
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an MCP configuration object')
  return value as Record<string, unknown>
}
function strings(value: unknown): Record<string, string> {
  const entries = Object.entries(value === undefined ? {} : record(value))
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('MCP environment and headers must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}
export async function loadPlugin(root: string, variables: Record<string, unknown> = {}, useEnvironment = true): Promise<LoadedPlugin> {
  const manifest = await loadManifest(root)
  const [skills, rules, agents] = await Promise.all((['skills', 'rules', 'agents'] as const).map((kind) => components(root, manifest[kind], kind)))
  const servers: Record<string, McpServer> = {}, missing = new Set<string>()
  const defaultMcp = await fs.access(path.join(root, 'mcp.json')).then(() => 'mcp.json').catch(() => undefined)
  const configs = manifest.mcpServers ?? defaultMcp
  for (const item of configs === undefined ? [] : Array.isArray(configs) ? configs : [configs]) {
    const raw = typeof item === 'string' ? JSON.parse(await readPluginFile(root, item)) : item
    const config = record(interpolate(raw, variables, missing, useEnvironment))
    for (const [name, value] of Object.entries(record(config.mcpServers ?? config))) {
      const server = record(value)
      if (server.disabled === true) continue
      if (server.type === 'stdio' || server.command) {
        if (typeof server.command !== 'string' || (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')))) throw new Error(`Invalid stdio server ${name}`)
        servers[name] = { type: 'stdio', command: server.command, args: server.args as string[] ?? [], env: strings(server.env) }
      } else {
        if (typeof server.url !== 'string' || (!server.url.includes('${') && !['http:', 'https:'].includes(new URL(server.url).protocol))) throw new Error(`Invalid MCP URL for ${name}`)
        if (server.type && !['http', 'sse'].includes(String(server.type))) throw new Error(`Unsupported MCP transport ${String(server.type)}`)
        servers[name] = { type: server.type === 'sse' ? 'sse' : 'http', url: server.url, headers: strings(server.headers) }
      }
    }
  }
  const defaultHooks = await fs.access(path.join(root, 'hooks/hooks.json')).then(() => 'hooks/hooks.json').catch(() => undefined)
  const hooks = manifest.hooks ?? defaultHooks
  const hookConfig = typeof hooks === 'string' ? JSON.parse(await readPluginFile(root, hooks)) : hooks
  await pluginFile(root, '.cursor-plugin/plugin.json')
  return { root, manifest, skills: skills!, rules: rules!, agents: agents!, servers, missingVariables: [...missing], hooks: hookConfig ? { supported: false, config: hookConfig } : null }
}
