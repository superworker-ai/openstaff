import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import type { WorkspaceObject, WorkspaceStore } from './types.js'
import { workspaceKey } from './types.js'

const MULTIPART_THRESHOLD = 16 * 1024 ** 2
const STREAM_THRESHOLD = 8 * 1024 ** 2
const PART_SIZE = 8 * 1024 ** 2

export interface S3WorkspaceConfig {
  endpoint?: string
  region: string
  bucket: string
  prefix: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle: boolean
  provider: 'aws' | 'r2' | 'minio' | 'other'
}

function cleanPrefix(value: string): string {
  const stripped = value.replace(/^\/+/, '')
  if (!stripped) return ''
  const checked = workspaceKey(stripped.replace(/\/+$/, ''))
  return `${checked}/`
}

export function readS3WorkspaceConfig(env: NodeJS.ProcessEnv = process.env): S3WorkspaceConfig {
  const configuredProvider = env.S3_PROVIDER?.trim() || 'other'
  if (!['aws', 'r2', 'minio', 'other'].includes(configuredProvider)) throw new Error('S3_PROVIDER must be aws, r2, minio, or other')
  const provider = configuredProvider as S3WorkspaceConfig['provider']
  const bucket = env.S3_BUCKET?.trim()
  if (!bucket) throw new Error('S3_BUCKET is required for S3 workspace storage')
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim(), secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim()
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error('Both S3 access key variables must be set together')
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: env.S3_REGION?.trim() || (provider === 'r2' ? 'auto' : 'us-east-1'),
    bucket,
    prefix: cleanPrefix(env.S3_PREFIX?.trim() || 'workspace/'),
    accessKeyId: accessKeyId || undefined,
    secretAccessKey: secretAccessKey || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === '1' || provider === 'minio',
    provider,
  }
}

function missing(error: unknown): boolean {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return value?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(value?.name ?? '')
}

async function bytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const value = body as { transformToByteArray?: () => Promise<Uint8Array>; [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> }
  if (value[Symbol.asyncIterator]) {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of value as AsyncIterable<Uint8Array>) { chunks.push(chunk); size += chunk.byteLength }
    const result = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  }
  if (value.transformToByteArray) return value.transformToByteArray()
  throw new Error('S3 workspace storage returned an unreadable object')
}

export class S3WorkspaceStore implements WorkspaceStore {
  readonly kind = 's3' as const
  readonly bucket: string
  readonly prefix: string
  readonly client: S3Client

  constructor(readonly config: S3WorkspaceConfig, client?: S3Client) {
    this.bucket = config.bucket
    this.prefix = cleanPrefix(config.prefix)
    const options: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      ...(config.accessKeyId && config.secretAccessKey ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } } : {}),
      ...(config.provider === 'r2' ? { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' } : {}),
    }
    this.client = client ?? new S3Client(options)
  }

  private objectKey(key: string): string { return `${this.prefix}${workspaceKey(key)}` }

  async get(key: string): Promise<Uint8Array> {
    const objectKey = this.objectKey(key)
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }))
      return await bytes(response.Body)
    } catch (error) {
      if (missing(error)) throw Object.assign(new Error('Workspace object not found'), { code: 'ENOENT' })
      throw new Error('S3 workspace storage read failed')
    }
  }

  async put(key: string, data: Uint8Array, opts: { contentType?: string } = {}): Promise<void> {
    const objectKey = this.objectKey(key)
    if (data.byteLength <= MULTIPART_THRESHOLD) {
      const body = data.byteLength > STREAM_THRESHOLD ? Readable.from([Buffer.from(data.buffer, data.byteOffset, data.byteLength)]) : data
      try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: body, ContentLength: data.byteLength, ContentType: opts.contentType })) }
      catch { throw new Error('S3 workspace storage write failed') }
      return
    }
    let uploadId: string | undefined
    try {
      const created = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, ContentType: opts.contentType }))
      uploadId = created.UploadId
      if (!uploadId) throw new Error('Multipart upload did not start')
      const parts = []
      for (let offset = 0, partNumber = 1; offset < data.byteLength; offset += PART_SIZE, partNumber += 1) {
        const result = await this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId, PartNumber: partNumber, Body: data.subarray(offset, Math.min(offset + PART_SIZE, data.byteLength)) }))
        parts.push({ ETag: result.ETag, PartNumber: partNumber })
      }
      await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId, MultipartUpload: { Parts: parts } }))
    } catch {
      if (uploadId) await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId })).catch(() => undefined)
      throw new Error('S3 workspace storage write failed')
    }
  }

  async delete(key: string): Promise<void> {
    const objectKey = this.objectKey(key)
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })) }
    catch { throw new Error('S3 workspace storage delete failed') }
  }

  async list(prefix: string): Promise<WorkspaceObject[]> {
    const safePrefix = workspaceKey(prefix, true), remotePrefix = `${this.prefix}${safePrefix}`
    const result: WorkspaceObject[] = []
    let token: string | undefined
    try {
      do {
        const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: remotePrefix, ContinuationToken: token }))
        for (const item of page.Contents ?? []) {
          if (!item.Key || !item.Key.startsWith(this.prefix)) continue
          const key = item.Key.slice(this.prefix.length)
          if (!key || key.endsWith('/')) continue
          result.push({ key, size: item.Size ?? 0, etag: item.ETag, lastModified: item.LastModified?.toISOString() })
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
      return result.sort((left, right) => left.key.localeCompare(right.key))
    } catch { throw new Error('S3 workspace storage list failed') }
  }

  async stat(key: string): Promise<{ size: number; etag?: string } | null> {
    const objectKey = this.objectKey(key)
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }))
      return { size: result.ContentLength ?? 0, etag: result.ETag }
    } catch (error) {
      if (missing(error)) return null
      throw new Error('S3 workspace storage stat failed')
    }
  }

  async healthy(): Promise<void> {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })) }
    catch { throw new Error('S3 workspace storage health check failed') }
  }
}
