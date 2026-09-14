import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../test/fixture.js'
import { DurableWorkspace } from './durable.js'
import { readS3WorkspaceConfig, S3WorkspaceStore } from './s3.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it('uses SQLite counts, coalesces health checks for 15 seconds, and never lists objects for status', async () => {
  const f = await fixture()
  const client = new S3Client({ region: 'us-east-1' })
  const send = vi.spyOn(client, 'send').mockResolvedValue(undefined)
  const store = new S3WorkspaceStore(readS3WorkspaceConfig({ S3_BUCKET: 'status-test' }), client)
  const durable = new DurableWorkspace(store, f.db)
  try {
    await durable.put('skills/test/SKILL.md', Buffer.from('description: cached'))
    send.mockClear(); vi.useFakeTimers()
    const values = await Promise.all([durable.status(), durable.status()])
    expect(values).toEqual([expect.objectContaining({ fileCount: 1, healthy: true }), expect.objectContaining({ fileCount: 1, healthy: true })])
    await durable.status()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadBucketCommand)
    await vi.advanceTimersByTimeAsync(15_001)
    send.mockRejectedValueOnce(new Error('secret-canary'))
    expect(await durable.status()).toMatchObject({ fileCount: 1, healthy: false })
    expect(await durable.status()).toMatchObject({ healthy: false })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.every(([command]) => command instanceof HeadBucketCommand)).toBe(true)
  } finally { client.destroy(); await f.close() }
})
