import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createApplication } from '../app.js'
import type { WorkspaceStore } from './types.js'

it('reports unhealthy workspace storage without exposing its error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-storage-health-'))
  const store: WorkspaceStore = {
    kind: 's3',
    get: async () => { throw Object.assign(new Error('credential-canary'), { code: 'ENOENT' }) },
    put: async () => {},
    delete: async () => {},
    list: async () => [],
    stat: async () => null,
    healthy: async () => { throw new Error('credential-canary') },
  }
  const application = await createApplication({ config: { dataDir: root }, workspaceStore: store })
  try {
    const response = await application.app.request('/api/health')
    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ ok: false, storage: { kind: 's3', healthy: false } })
    expect(body).not.toContain('credential-canary')
  } finally { await application.close(); await fs.rm(root, { recursive: true, force: true }) }
})
