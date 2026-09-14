import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { request, type Dispatcher } from 'undici'
import type { ProxiedDesktopEndpoints } from '../computer/types.js'
import type { ApiDependencies, AppEnv } from './context.js'
import { originAllowed } from './origin.js'

export const DESKTOP_PREFIX = '/api/computer/desktop'
export type DesktopMode = 'viewer' | 'controller'
export type DesktopSessionMode = 'viewer' | 'control'

const probes = new Map<string, { expires: number; value: Promise<boolean> }>()

export function desktopAuthorization(desktop: ProxiedDesktopEndpoints, mode: DesktopMode): string {
  const credentials = desktop[mode]
  return `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`
}

export function desktopTarget(streamUrl: string, requestUrl: string): URL {
  const incoming = new URL(requestUrl)
  const suffix = incoming.pathname.slice(DESKTOP_PREFIX.length) || '/'
  const base = new URL(streamUrl)
  base.pathname = `${base.pathname.replace(/\/$/, '')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
  base.search = incoming.search
  base.searchParams.delete('mode')
  return base
}

export function desktopStreamReady(desktop: ProxiedDesktopEndpoints, mode: DesktopMode): Promise<boolean> {
  const key = `${desktop.streamUrl}:${mode}`
  const existing = probes.get(key)
  if (existing && Date.now() < existing.expires) return existing.value
  const value = request(desktop.streamUrl, {
    method: 'GET',
    headers: { authorization: desktopAuthorization(desktop, mode) },
    headersTimeout: 2000,
    bodyTimeout: 2000,
  }).then(async (response) => { await response.body.dump(); return response.statusCode >= 200 && response.statusCode < 400 }).catch(() => false)
  probes.set(key, { expires: Date.now() + 5000, value })
  return value
}

function requestHeaders(request: Request, authorization: string): Record<string, string> {
  const headers: Record<string, string> = { authorization }
  for (const name of ['accept', 'range', 'content-type']) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  return headers
}

function responseHeaders(headers: Record<string, string | string[] | undefined>, desktop: ProxiedDesktopEndpoints, target: URL): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade'].includes(name.toLowerCase())) continue
    result.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const location = result.get('location')
  if (location) {
    const resolved = new URL(location, target)
    if (resolved.origin === new URL(desktop.streamUrl).origin) result.set('location', `${DESKTOP_PREFIX}${resolved.pathname}${resolved.search}${resolved.hash}`)
  }
  if (result.get('content-type')?.toLowerCase().includes('text/html')) result.set('cache-control', 'no-store')
  return result
}

export function computerDesktopRoutes({ computer, config, lease }: Pick<ApiDependencies, 'computer' | 'config' | 'lease'>): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/session', async (context) => {
    context.header('Cache-Control', 'no-store')
    if (!originAllowed(context.req.header('origin'), { publicAppUrl: config.publicAppUrl, headers: context.req.raw.headers, requestUrl: context.req.url })) return context.json({ error: 'Origin not allowed' }, 403)
    const requested = context.req.query('mode')
    if (requested !== 'viewer' && requested !== 'control') return context.json({ error: 'mode must be viewer or control' }, 400)
    const desktop = await computer.desktop()
    if (!desktop) return context.json({ error: 'Computer desktop unavailable' }, 503)
    if (desktop.kind !== 'external') return context.json({ error: 'proxied-stream' }, 409)
    const current = requested === 'control' ? await lease.current() : null
    const controls = requested === 'control' && current?.ownerKind === 'human' && current.ownerId === context.get('user').id
    const kind: DesktopSessionMode = controls ? 'control' : 'viewer'
    try { return context.json({ kind, url: await (controls ? desktop.controllerUrl() : desktop.viewerUrl()) }) }
    catch { return context.json({ error: 'Computer desktop unavailable' }, 503) }
  })
  app.all('/*', async (context) => {
    if (!originAllowed(context.req.header('origin'), { publicAppUrl: config.publicAppUrl, headers: context.req.raw.headers, requestUrl: context.req.url })) return context.json({ error: 'Origin not allowed' }, 403)
    const requestedControl = new URL(context.req.url).searchParams.get('mode') === 'control'
    const current = requestedControl ? await lease.current() : null
    const mode: DesktopMode = requestedControl && current?.ownerKind === 'human' && current.ownerId === context.get('user').id ? 'controller' : 'viewer'
    const desktop = await computer.desktop()
    if (desktop?.kind === 'external') return context.json({ error: 'external-stream' }, 409)
    if (!desktop || !await desktopStreamReady(desktop, mode)) return context.json({ error: 'Computer desktop unavailable' }, 503)
    const target = desktopTarget(desktop.streamUrl, context.req.url)
    try {
      const method = context.req.method as Dispatcher.HttpMethod
      const body = ['GET', 'HEAD'].includes(method) || !context.req.raw.body
        ? undefined
        : Readable.fromWeb(context.req.raw.body as import('node:stream/web').ReadableStream<Uint8Array>)
      const upstream = await request(target, { method, body, headers: requestHeaders(context.req.raw, desktopAuthorization(desktop, mode)), headersTimeout: 5000, bodyTimeout: 30_000 })
      return new Response(Readable.toWeb(upstream.body) as ReadableStream<Uint8Array>, {
        status: upstream.statusCode,
        headers: responseHeaders(upstream.headers, desktop, target),
      })
    } catch { return context.json({ error: 'Computer desktop unavailable' }, 503) }
  })
  return app
}
