import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { desktopPasswords } from './desktop-secrets.js'

afterEach(() => vi.unstubAllEnvs())

it('creates reusable desktop passwords in a private file', async () => {
  vi.stubEnv('COMPUTER_VIEWER_PASSWORD', '')
  vi.stubEnv('COMPUTER_CONTROLLER_PASSWORD', '')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-secrets-'))
  try {
    const first = await desktopPasswords(directory)
    const second = await desktopPasswords(directory)
    expect(first).toEqual(second)
    expect(first.viewer).toMatch(/^[a-f0-9]{64}$/)
    expect(first.controller).toMatch(/^[a-f0-9]{64}$/)
    const stat = await fs.stat(path.join(directory, 'secrets', 'computer-desktop.json'))
    expect(stat.mode & 0o777).toBe(0o600)
  } finally { await fs.rm(directory, { recursive: true }) }
})

it('uses configured passwords without writing them to disk', async () => {
  vi.stubEnv('COMPUTER_VIEWER_PASSWORD', 'configured-viewer')
  vi.stubEnv('COMPUTER_CONTROLLER_PASSWORD', 'configured-controller')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-secrets-'))
  try {
    expect(await desktopPasswords(directory)).toEqual({ viewer: 'configured-viewer', controller: 'configured-controller' })
    await expect(fs.stat(path.join(directory, 'secrets'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await fs.rm(directory, { recursive: true }) }
})
