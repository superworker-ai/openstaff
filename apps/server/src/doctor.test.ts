import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runDoctor } from './doctor.js'
import { createDatabase } from './db/index.js'
import { S3Client } from '@aws-sdk/client-s3'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
it('allows production startup to migrate a fresh volume, then reports current migrations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-review-'))
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('COMPUTER_DRIVER', 'local')
  vi.stubEnv('SECRETS_KEY', 'a'.repeat(64)); vi.stubEnv('PUBLIC_APP_URL', 'https://fixture.example.test'); vi.stubEnv('XAI_API_KEY', 'doctor-canary')
  try {
    const fresh = await runDoctor()
    expect(fresh.ok).toBe(true)
    expect(fresh.results).toContainEqual(expect.objectContaining({ name: 'SQLITE_MIGRATIONS', ok: false, hard: false }))
    expect(JSON.stringify(fresh)).not.toContain('doctor-canary')
    const handle = await createDatabase(root); handle.close()
    expect((await runDoctor()).results).toContainEqual(expect.objectContaining({ name: 'SQLITE_MIGRATIONS', ok: true }))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
it('makes S3 storage health hard in production without exposing credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-storage-'))
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('COMPUTER_DRIVER', 'local')
  vi.stubEnv('SECRETS_KEY', 'a'.repeat(64)); vi.stubEnv('PUBLIC_APP_URL', 'https://fixture.example.test'); vi.stubEnv('XAI_API_KEY', 'doctor-canary')
  vi.stubEnv('WORKSPACE_STORE', 's3'); vi.stubEnv('S3_BUCKET', 'doctor-bucket'); vi.stubEnv('S3_REGION', 'us-east-1')
  vi.stubEnv('S3_ACCESS_KEY_ID', 'access-canary'); vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret-canary')
  vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('secret-canary'))
  try {
    const result = await runDoctor(), storage = result.results.find((item) => item.name === 'WORKSPACE_STORE')
    expect(result.ok).toBe(false)
    expect(storage).toMatchObject({ ok: false, hard: true, detail: 's3 bucket doctor-bucket unreachable' })
    expect(JSON.stringify(result)).not.toContain('secret-canary')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
