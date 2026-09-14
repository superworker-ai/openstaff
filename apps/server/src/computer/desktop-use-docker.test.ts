import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { dockerClient } from './docker.js'
import { ManagedDockerComputer } from './docker-provider.js'
import { desktopWindows } from './computer-tools.js'

afterEach(() => vi.unstubAllEnvs())

it.skipIf(process.env.DOCKER_TESTS !== '1')('captures and operates a throwaway real Docker desktop', async () => {
  const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`
  const name = `sw-desktop-phasec-${suffix}`
  const homeVolume = `sw-desktop-phasec-home-${suffix}`
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-desktop-phasec-'))
  const docker = dockerClient()
  vi.stubEnv('COMPUTER_HOME_VOLUME', homeVolume)
  vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', '')
  vi.stubEnv('COMPUTER_NETWORK', 'bridge')
  vi.stubEnv('COMPUTER_CHROME_NO_SANDBOX', '1')
  const computer = new ManagedDockerComputer(root, docker, name, { viewer: 'viewer-phasec', controller: 'controller-phasec' })
  try {
    await computer.restart()
    await vi.waitFor(async () => {
      const status = (await docker.getContainer(name).inspect()).State.Health?.Status
      expect(status).toBe('healthy')
    }, { timeout: 90_000, interval: 1000 })

    const before = await computer.captureScreen({ quality: 60 })
    expect(before).toMatchObject({ width: 1280, height: 800 })
    expect(before.mediaType).toBe('image/jpeg')
    expect(Buffer.from(before.image).subarray(0, 2).toString('hex')).toBe('ffd8')

    await computer.desktopInput({ type: 'key', key: 'ctrl+l' })
    await computer.desktopInput({ type: 'type', text: 'https://example.com' })
    await computer.desktopInput({ type: 'key', key: 'Return' })
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const after = await computer.captureScreen({ quality: 60 })
    expect(after).toMatchObject({ width: 1280, height: 800 })
    expect(Buffer.from(after.image).equals(Buffer.from(before.image))).toBe(false)
    expect((await desktopWindows(computer)).some((window) => /chrom(e|ium)/i.test(window.title))).toBe(true)

    const directory = path.resolve('.context/screenshots')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'desktop-phaseC-before.jpg'), before.image)
    await fs.writeFile(path.join(directory, 'desktop-phaseC-after.jpg'), after.image)
  } finally {
    await docker.getContainer(name).remove({ force: true }).catch(() => undefined)
    await docker.getVolume(homeVolume).remove({ force: true }).catch(() => undefined)
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)
