import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Computer } from '../computer/types.js'
import type { ApiDependencies, AppEnv } from './context.js'
import type { DurableWorkspace } from '../storage/durable.js'

export const fileAttachmentSchema = z.object({ subtype: z.literal('file'), path: z.string(), name: z.string().max(160), size: z.number().int().min(0).max(20 * 1024 ** 2) })
export function safeFilename(name: string): string { return path.basename(name.replaceAll('\\', '/')).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file' }
export async function validateAttachments(computer: Computer, roomId: string, files: z.infer<typeof fileAttachmentSchema>[], durable?: DurableWorkspace) {
  for (const file of files) {
    if (path.posix.dirname(file.path) !== `/workspace/uploads/${roomId}` || file.name !== safeFilename(file.name)) throw new Error('Invalid attachment path')
    const stat = durable ? await durable.stat(file.path.slice('/workspace/'.length)) : await computer.stat(file.path)
    if (!stat || (!durable && !('isFile' in stat && stat.isFile)) || stat.size !== file.size) throw new Error('Attachment does not match uploaded file')
  }
}
export function uploadRoutes({ computer, durable, admission }: ApiDependencies) {
  const app = new Hono<AppEnv>()
  app.post('/:id/uploads', bodyLimit({ maxSize: 20 * 1024 ** 2 + 65536 }), async (c) => {
    const roomId = c.req.param('id')
    if (!await admission.isMember(roomId, 'user', c.get('user').id)) return c.notFound()
    const form = await c.req.formData(), file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'Supply a file' }, 400)
    if (file.size > 20 * 1024 ** 2) return c.json({ error: 'File limit is 20 MB' }, 413)
    const name = safeFilename(file.name), virtualPath = `/workspace/uploads/${roomId}/${randomUUID()}-${name}`
    const key = virtualPath.slice('/workspace/'.length)
    if (await durable.stat(key)) return c.json({ error: 'Upload already exists' }, 409)
    await durable.writeThrough(computer, key, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || undefined })
    return c.json({ attachment: { subtype: 'file', path: virtualPath, name, size: file.size } }, 201)
  })
  return app
}
