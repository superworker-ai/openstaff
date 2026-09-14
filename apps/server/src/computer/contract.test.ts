import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeProvider } from './fake.js'
import { localProvider } from './local-provider.js'
import { dockerProvider } from './docker-provider.js'
import { dockerClient } from './docker.js'
import { e2bProvider } from './e2b.js'
import { daytonaProvider } from './daytona.js'
import { freestyleProvider } from './freestyle.js'
import { vercelProvider } from './vercel.js'
import { PathJailError } from './path-jail.js'
import { cleanupE2BSandboxes, recordE2BSandboxes } from '../test/e2b-contract-cleanup.js'
import { cleanupFreestyleVms, recordFreestyleVms } from '../test/freestyle-contract-cleanup.js'
import { cleanupVercelSandboxes, recordVercelSandboxes } from '../test/vercel-contract-cleanup.js'
import type { ComputerProvider } from './provider.js'
import type { ManagedComputer } from './types.js'

function suite(name: string, provider: ComputerProvider, enabled = true, credentials: Record<string, string> = {}) {
  describe.skipIf(!enabled)(`${name} Computer contract`, () => {
    let computer: ManagedComputer, root: string, homeVolume: string | undefined, dockerName: string | undefined
    const sandboxIds = new Set<string>(), freestyleVmIds = new Set<string>(), vercelSandboxIds = new Set<string>()
    beforeAll(async () => {
      root = await fs.mkdtemp(path.resolve('data-test-contract-'))
      const workspaceRoot = path.join(root, 'workspace')
      await fs.mkdir(workspaceRoot, { mode: 0o777 }); await fs.chmod(workspaceRoot, 0o777)
      if (provider.id === 'docker') {
        homeVolume = `sw-contract-home-${crypto.randomUUID()}`
        vi.stubEnv('COMPUTER_HOME_VOLUME', homeVolume)
        vi.stubEnv('COMPUTER_WORKSPACE_VOLUME', '')
        vi.stubEnv('COMPUTER_NETWORK', 'bridge')
        vi.stubEnv('COMPUTER_VIEWER_PASSWORD', 'contract-viewer-fixture')
        vi.stubEnv('COMPUTER_CONTROLLER_PASSWORD', 'contract-controller-fixture')
      }
      const now = new Date().toISOString()
      // A unique Docker instance prevents tests from taking over a user's Computer.
      dockerName = provider.id === 'docker' ? `sw-contract-${crypto.randomUUID()}` : undefined
      const instance = dockerName ? { id: 'contract', provider: provider.id, externalId: dockerName, status: 'stopped', createdAt: now, lastSeenAt: now, metadata: {} } : null
      computer = await provider.open({ credentials, workspaceRoot, instanceId: 'cmp-contract', instance, persist: async ({ externalId }) => {
        if (provider.id === 'e2b') { sandboxIds.add(externalId); await recordE2BSandboxes(sandboxIds) }
        if (provider.id === 'freestyle') { freestyleVmIds.add(externalId); await recordFreestyleVms(freestyleVmIds) }
        if (provider.id === 'vercel') { vercelSandboxIds.add(externalId); await recordVercelSandboxes(vercelSandboxIds) }
      } })
    }, 120_000)
    afterAll(async () => {
      try {
        try { if (computer) { await computer.destroy(); await computer.close() } }
        finally {
          // Capture IDs during open so failed bootstrap/tests still have cleanup.
          await cleanupE2BSandboxes(sandboxIds, credentials.apiKey)
          await cleanupFreestyleVms(freestyleVmIds, credentials.apiKey, credentials.baseUrl)
          await cleanupVercelSandboxes(vercelSandboxIds, credentials)
        }
      } finally {
        try {
          if (dockerName) await dockerClient().getContainer(dockerName).remove({ force: true }).catch((error: { statusCode?: number }) => { if (error.statusCode !== 404) throw new Error('Test Docker container cleanup failed') })
          if (homeVolume) await dockerClient().getVolume(homeVolume).remove().catch(() => undefined)
          if (root) await fs.rm(root, { recursive: true, force: true })
        } finally { vi.unstubAllEnvs() }
      }
    }, 120_000)
    it('executes with scrubbed environment and caps each output stream at 16 KB', async () => {
      vi.stubEnv('XAI_API_KEY', 'contract-canary')
      expect((await computer.exec('printf hello')).stdout).toBe('hello')
      // Boolean assertions cannot print a real vendor key on failure.
      const environment = (await computer.exec('printenv')).stdout
      expect(environment.includes('contract-canary')).toBe(false)
      for (const secret of Object.values(credentials).filter(Boolean)) expect(environment.includes(secret)).toBe(false)
      const result = await computer.exec("head -c 20000 /dev/zero | tr '\\000' x; head -c 20000 /dev/zero | tr '\\000' y >&2")
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16384)
      expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(16000)
      expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(16384)
    })
    it('returns nonzero shell exits with stdout and stderr instead of throwing', async () => {
      expect(await computer.exec('printf output; printf failure >&2; exit 7')).toEqual({ stdout: 'output', stderr: 'failure', code: 7 })
    })
    it('honours timeout and abort', async () => {
      const timedOut = await computer.exec('sleep 5', { timeoutMs: 100 })
      expect(timedOut.code).toBe(124)
      if (provider.id === 'e2b') expect(timedOut.stderr).toContain('Terminated: timeout')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 50)
      try {
        const result = await computer.exec('sleep 5', { signal: controller.signal, timeoutMs: 1000 }).catch((error: unknown) => {
          expect(error).toMatchObject({ name: 'AbortError' })
          return { code: 130 }
        })
        expect(result.code).not.toBe(0)
      }
      finally { clearTimeout(timer) }
    })
    it('round-trips text/bytes, lists, stats, makes directories, and rejects escapes', async () => {
      await computer.mkdir('nested')
      await computer.writeFile('nested/text.txt', 'hello')
      await computer.writeFile('nested/bytes.bin', new Uint8Array([104, 105]))
      expect(await computer.readFile('/workspace/nested/text.txt')).toBe('hello')
      expect(await computer.readFile('nested/bytes.bin')).toBe('hi')
      expect(await computer.list('nested')).toEqual(expect.arrayContaining([{ name: 'text.txt', type: 'file' }]))
      expect(await computer.stat('nested')).toMatchObject({ isDirectory: true })
      expect(await computer.stat('nested/bytes.bin')).toMatchObject({ isFile: true, size: 2 })
      await computer.writeFile('nested/binary.bin', new Uint8Array([0, 128, 255, 10]))
      expect((await computer.exec('od -An -tu1 nested/binary.bin')).stdout.trim().split(/\s+/).map(Number)).toEqual([0, 128, 255, 10])
      await expect(computer.writeFile('../outside', 'no')).rejects.toBeInstanceOf(PathJailError)
    })
  })
}
suite('local', localProvider)
suite('fake', fakeProvider)
suite('docker', dockerProvider, process.env.DOCKER_TESTS === '1')
suite('e2b', e2bProvider, process.env.E2B_TESTS === '1', { apiKey: process.env.E2B_API_KEY ?? '' })
suite('daytona', daytonaProvider, process.env.DAYTONA_TESTS === '1', { apiKey: process.env.DAYTONA_API_KEY ?? '', apiUrl: process.env.DAYTONA_API_URL ?? '', target: process.env.DAYTONA_TARGET ?? '' })
suite('freestyle', freestyleProvider, process.env.FREESTYLE_TESTS === '1', { apiKey: process.env.FREESTYLE_API_KEY ?? '', baseUrl: process.env.FREESTYLE_BASE_URL ?? '' })
suite('vercel', vercelProvider, process.env.VERCEL_TESTS === '1', { token: process.env.VERCEL_TOKEN ?? '', teamId: process.env.VERCEL_TEAM_ID ?? '', projectId: process.env.VERCEL_PROJECT_ID ?? '' })
