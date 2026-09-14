import type { Context } from 'hono'
import type { ZodType } from 'zod'

export async function parseBody<T>(context: Context, schema: ZodType<T>): Promise<T | Response> {
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ error: 'Invalid JSON body' }, 400) }
  const result = schema.safeParse(body)
  if (!result.success) return context.json({ error: 'Invalid request', details: result.error.issues }, 400)
  return result.data
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}
