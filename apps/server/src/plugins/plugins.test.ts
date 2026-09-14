import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { validateManifest } from '@openstaff/shared/plugins'
import { plugins } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { Secrets } from '../secrets.js'
import { interpolate, loadPlugin } from './loader.js'
import { PluginRegistry } from './registry.js'
import { PluginInstaller } from './installer.js'
import { namespaceTools } from './mcp.js'
import { buildTurnPrompt } from '../agent/prompt.js'

const fixtures = path.join(import.meta.dirname, '__fixtures__')
afterEach(() => vi.unstubAllEnvs())
it('validates names, unknown fields and strict client versions using Cursor schemas', () => {
  expect(validateManifest({ name: 'a.plugin-1', minClientVersions: { cursor: '3.13.0', grokbot: 'never', custom: '1.0.0-rc.1' } }).name).toBe('a.plugin-1')
  for (const value of [{ name: 'Bad Name' }, { name: '-bad' }, { name: 'good', unexpected: true }, { name: 'good', minClientVersions: {} }, { name: 'good', minClientVersions: { cursor: 'v1.2' } }, { name: 'good', minClientVersions: { cursor: '01.2.3' } }]) expect(() => validateManifest(value)).toThrow()
})
it('parses three Ralph skills, preserves frontmatter, and flags hooks unsupported', async () => {
  const plugin = await loadPlugin(path.join(fixtures, 'ralph-loop'))
  expect(plugin.skills.map((skill) => skill.name)).toEqual(['cancel-ralph', 'ralph-loop-help', 'ralph-loop'])
  expect(plugin.hooks).toMatchObject({ supported: false, config: { version: 1 } })
  expect(plugin.skills[0]?.frontmatter.description).toContain('Cancel')
})
it('interpolates only supplied variables and explicit plugin environment values', async () => {
  vi.stubEnv('XERO_CLIENT_SECRET', 'server-secret-not-allowed')
  vi.stubEnv('PLUGIN_ENV_XERO_CLIENT_ID', 'safe-id')
  const plugin = await loadPlugin(path.join(fixtures, 'xero'), { XERO_CLIENT_SECRET: 'plugin-secret' })
  expect(plugin.servers.xero).toMatchObject({ type: 'stdio', env: { XERO_CLIENT_ID: 'safe-id', XERO_CLIENT_SECRET: 'plugin-secret' } })
  expect(interpolate('${XERO_CLIENT_SECRET}', {})).toBe('${XERO_CLIENT_SECRET}')
  expect(plugin.missingVariables).toEqual([])
})
it('namespaces MCP tools without changing their definitions', () => {
  expect(namespaceTools('xero', { read: { description: 'test', inputSchema: {} as never } })).toHaveProperty('xero__read')
})

it('expands directory globs, preserves unknown frontmatter, and injects rules and hints', async () => {
  const f = await fixture()
  try {
    const root = path.join(f.directory, 'source')
    for (const dir of ['.cursor-plugin', 'skills/example', 'rules', 'agents']) await fs.mkdir(path.join(root, dir), { recursive: true })
    await fs.writeFile(path.join(root, '.cursor-plugin/plugin.json'), JSON.stringify({ name: 'custom', skills: 'skills/*' }))
    await fs.writeFile(path.join(root, 'skills/example/SKILL.md'), '---\nname: example\ndescription: Example skill\ncustom-key: preserved\n---\nRead sibling.txt.')
    await fs.writeFile(path.join(root, 'skills/example/sibling.txt'), 'Sibling context')
    await fs.writeFile(path.join(root, 'rules/example.mdc'), '---\nalwaysApply: true\nglobs: ["*.ts"]\n---\nUse clear variable names.')
    await fs.writeFile(path.join(root, 'agents/reviewer.md'), '---\nname: reviewer\ndescription: Review changes carefully\n---\nAgent body')
    const loaded = await loadPlugin(root)
    expect(loaded.skills).toHaveLength(1)
    expect(loaded.skills[0]?.frontmatter['custom-key']).toBe('preserved')
    expect(loaded.rules[0]?.frontmatter.globs).toEqual(['*.ts'])
    const secrets = await Secrets.open(f.directory), registry = new PluginRegistry(f.db, secrets)
    await new PluginInstaller(f.db, f.directory, secrets, registry).install(`path:${root}`)
    const trigger = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'hi' })
    const prompt = await buildTurnPrompt(f.db, f.computer, { roomId: f.roomId, botId: f.botId, triggerMessageId: trigger.message.id }, 60, registry)
    expect(prompt.instructions).toContain('custom/example: Example skill')
    expect(prompt.instructions).toContain('Use clear variable names.')
    expect(prompt.instructions).toContain('custom/reviewer: Review changes carefully')
    expect(await registry.readFile('custom', 'skills/example/sibling.txt')).toBe('Sibling context')
  } finally { await f.close() }
})
it('installs a local copy and rebuilds the enabled registry', async () => {
  const f = await fixture()
  try {
    const secrets = await Secrets.open(f.directory), registry = new PluginRegistry(f.db, secrets)
    const installer = new PluginInstaller(f.db, f.directory, secrets, registry)
    const id = await installer.install(`path:${path.join(fixtures, 'ralph-loop')}`)
    const row = (await f.db.select().from(plugins))[0]!
    expect(row.id).toBe(id)
    expect(row.rootPath).toBe(path.join(f.directory, 'plugins/ralph-loop'))
    expect(registry.enabled()[0]?.skills).toHaveLength(3)
    expect(await registry.readSkill('ralph-loop/cancel-ralph')).toContain('# Cancel Ralph')
    await expect(registry.readFile('ralph-loop', '../secrets.key')).rejects.toThrow()
    await expect(installer.install(`path:${path.join(fixtures, 'ralph-loop')}`)).rejects.toThrow('already installed')
    await installer.remove(id)
    expect(registry.enabled()).toHaveLength(0)
    await expect(fs.stat(row.rootPath)).rejects.toThrow()
  } finally { await f.close() }
})
