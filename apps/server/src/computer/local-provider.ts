import type { ComputerCapabilities } from '@openstaff/shared'
import { z } from 'zod'
import { LocalComputer } from './local.js'
import type { ComputerProvider } from './provider.js'
import type { ManagedComputer } from './types.js'

const capabilities: ComputerCapabilities = { persistent: true, snapshots: false, explicitStop: false, hostFiles: true, desktop: false, volume: false }

class ManagedLocalComputer extends LocalComputer implements ManagedComputer {
  async status() { return { provider: 'local' as const, status: 'ready' as const, lockedByEnv: Boolean(process.env.COMPUTER_DRIVER), detail: 'Server workspace directory' } }
  async restart() { await this.initialize() }
  async destroy() { await this.initialize() }
  async close() {}
}

export const localProvider: ComputerProvider = {
  id: 'local', label: 'Local', capabilities, credentialSchema: z.object({}), fields: [],
  async validateCredentials() {},
  async open({ workspaceRoot }) { const computer = new ManagedLocalComputer(workspaceRoot); await computer.initialize(); return computer },
}
