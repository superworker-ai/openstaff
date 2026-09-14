import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface DesktopPasswords {
  viewer: string
  controller: string
}

function valid(value: unknown): value is DesktopPasswords {
  return Boolean(value && typeof value === 'object'
    && typeof (value as DesktopPasswords).viewer === 'string'
    && typeof (value as DesktopPasswords).controller === 'string')
}

async function read(file: string): Promise<DesktopPasswords | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!valid(value)) throw new Error('Invalid desktop secrets file')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function desktopPasswords(dataDir: string): Promise<DesktopPasswords> {
  const configured = {
    viewer: process.env.COMPUTER_VIEWER_PASSWORD || undefined,
    controller: process.env.COMPUTER_CONTROLLER_PASSWORD || undefined,
  }
  if (configured.viewer && configured.controller) return { viewer: configured.viewer, controller: configured.controller }

  const directory = path.join(dataDir, 'secrets')
  const file = path.join(directory, 'computer-desktop.json')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  let stored = await read(file)
  if (!stored) {
    const generated = { viewer: randomBytes(32).toString('hex'), controller: randomBytes(32).toString('hex') }
    try {
      await fs.writeFile(file, `${JSON.stringify(generated)}\n`, { flag: 'wx', mode: 0o600 })
      stored = generated
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      stored = await read(file)
    }
  }
  if (!stored) throw new Error('Desktop secrets could not be initialized')
  await fs.chmod(file, 0o600)
  return { viewer: configured.viewer ?? stored.viewer, controller: configured.controller ?? stored.controller }
}
