import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { screenshotContextLimit } from './agent/screenshot-context.js'

const infrastructure = new Set(['PUBLIC_API_URL', 'PUBLIC_HOST', 'OPENSTAFF_VERSION', 'GHCR_OWNER', 'BACKUP_KEEP', 'WORKSPACE_HOST_PATH'])
const runtime = new Set(['NODE_ENV', 'PATH', 'LANG', 'DOCKER_TESTS', 'S3_TESTS', 'SKIP_BROWSER_TESTS', 'COMPUTER_ALLOW_FAKE'])
const derived = ['COMPOSIO_API_KEY', 'E2B_API_KEY', 'DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_TARGET', 'FREESTYLE_API_KEY', 'FREESTYLE_BASE_URL', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']

it('documents every configured environment variable', async () => {
  const root = path.resolve(import.meta.dirname, '../../..')
  const source = await fs.readFile(path.join(root, '.env.example'), 'utf8')
  expect(/^COMPUTER_SCREENSHOT_CONTEXT=(.*)$/m.exec(source)?.[1]).toBe(String(screenshotContextLimit('')))
  const documented = new Set([...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!))
  const files = await fs.readdir(path.join(root, 'apps/server/src'), { recursive: true })
  const names = new Set<string>(derived)
  for (const entry of files.filter((item) => item.endsWith('.ts'))) {
    const text = await fs.readFile(path.join(root, 'apps/server/src', entry), 'utf8')
    for (const match of text.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]!)
  }
  for (const name of names) if (!runtime.has(name)) expect(documented.has(name), name).toBe(true)
  for (const name of documented) expect(names.has(name) || infrastructure.has(name), name).toBe(true)
})
