import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ComputerCapabilities } from '@openstaff/shared'
import { z } from 'zod'
import { LocalComputer } from './local.js'
import type { ComputerProvider } from './provider.js'
import type { ManagedComputer } from './types.js'

const capabilities: ComputerCapabilities = { persistent: false, snapshots: false, explicitStop: true, hostFiles: true, desktop: false, volume: false }
class FakeComputer extends LocalComputer implements ManagedComputer {
  private state: 'ready' | 'paused' | 'stopped' = 'ready'
  async status() { return { provider: 'local' as const, status: this.state, lockedByEnv: false, detail: 'Test-only fake computer' } }
  async restart() { this.state = 'ready'; await this.initialize() }
  async stop() { this.state = 'paused' }
  async destroy() { this.state = 'stopped' }
  async close() {}
  override async exec(command: string, options = {}) { if (this.state !== 'ready') await this.restart(); return super.exec(command, options) }
}
export const fakeProvider: ComputerProvider = {
  id: 'local', label: 'Fake', capabilities, credentialSchema: z.object({}), fields: [], async validateCredentials() {},
  async open({ workspaceRoot }) { const root = workspaceRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-fake-')); const computer = new FakeComputer(root); await computer.initialize(); return computer },
}
