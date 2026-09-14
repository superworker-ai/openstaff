import { CreateBucketCommand, DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceStoreContract } from './contract.js'
import { readS3WorkspaceConfig, S3WorkspaceStore } from './s3.js'

describe.skipIf(process.env.S3_TESTS !== '1')('S3 workspace store against MinIO', () => {
  let store: S3WorkspaceStore, client: S3Client
  const prefix = `contracts/${crypto.randomUUID()}/workspace/`
  beforeAll(async () => {
    const config = readS3WorkspaceConfig({ ...process.env, S3_PROVIDER: 'minio', S3_PREFIX: prefix })
    client = new S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId!, secretAccessKey: config.secretAccessKey! } })
    let lastError: unknown
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((error: { name?: string }) => { if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name ?? '')) throw error })
        lastError = undefined
        break
      } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 1000)) }
    }
    if (lastError) throw new Error('MinIO did not become ready for the storage contract')
    store = new S3WorkspaceStore(config, client)
    await store.healthy()
  })
  afterAll(async () => {
    if (!store) return
    const objects = await store.list('')
    if (objects.length) await client.send(new DeleteObjectsCommand({ Bucket: store.bucket, Delete: { Objects: objects.map((item) => ({ Key: `${store.prefix}${item.key}` })) } }))
    client.destroy()
  })
  workspaceStoreContract(() => store)

  it('does not expose objects outside its configured prefix', async () => {
    const key = `contracts/${crypto.randomUUID()}/outside.txt`
    await client.send(new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: 'outside' }))
    expect(await store.list('')).toEqual(expect.not.arrayContaining([expect.objectContaining({ key })]))
    await client.send(new DeleteObjectsCommand({ Bucket: store.bucket, Delete: { Objects: [{ Key: key }] } }))
  })
})
