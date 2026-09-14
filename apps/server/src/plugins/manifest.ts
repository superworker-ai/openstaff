import fs from 'node:fs/promises'
import path from 'node:path'
import { validateManifest } from '@openstaff/shared/plugins'
import { assertJailedRealPath, resolveJailedPath } from '../computer/path-jail.js'

export async function pluginFile(root: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error('Plugin paths must be relative')
  const file = resolveJailedPath(root, relativePath)
  await assertJailedRealPath(root, file)
  return file
}
export async function readPluginFile(root: string, relativePath: string): Promise<string> {
  return fs.readFile(await pluginFile(root, relativePath), 'utf8')
}
export async function loadManifest(root: string) {
  return validateManifest(JSON.parse(await readPluginFile(root, '.cursor-plugin/plugin.json')))
}
