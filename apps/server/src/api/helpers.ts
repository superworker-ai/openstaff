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

/**
 * Origin the browser actually sees. Hono's node adapter ignores `x-forwarded-*`, so a proxied
 * deploy without `PUBLIC_APP_URL` would otherwise build an `http://` postMessage target that the
 * `https://` opener silently drops.
 */
export function publicOrigin(context: Context, config: { publicAppUrl?: string }): string {
  if (config.publicAppUrl) return config.publicAppUrl
  const first = (value: string | undefined) => value?.split(',')[0]?.trim() || undefined
  const host = first(context.req.header('x-forwarded-host'))
  if (!host) return context.req.url
  return `${first(context.req.header('x-forwarded-proto')) ?? new URL(context.req.url).protocol.replace(':', '')}://${host}`
}
