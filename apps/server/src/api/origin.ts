import type { IncomingHttpHeaders } from 'node:http'

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(',')[0]?.trim() || undefined
}

function isLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost')
}

/**
 * Decide whether a browser Origin may reach the desktop stream. Same-origin `crossorigin`
 * asset fetches and WebSocket upgrades carry an Origin header, so this must recognise the
 * app's own origin even when a dev proxy (Vite) or reverse proxy rewrote the Host header.
 */
export function originAllowed(origin: string | undefined, input: { publicAppUrl?: string; headers: IncomingHttpHeaders | Headers; requestUrl: string; encrypted?: boolean }): boolean {
  if (!origin) return true
  let parsed: URL
  try { parsed = new URL(origin) } catch { return false }
  const header = (name: string) => input.headers instanceof Headers ? input.headers.get(name) ?? undefined : first(input.headers[name])
  const candidates = new Set<string>()
  if (input.publicAppUrl) { try { candidates.add(new URL(input.publicAppUrl).origin) } catch { /* ignore malformed */ } }
  const forwardedHost = header('x-forwarded-host'), host = forwardedHost ?? header('host')
  if (host) {
    const protocol = header('x-forwarded-proto') ?? (input.encrypted ? 'https' : new URL(input.requestUrl).protocol.replace(':', ''))
    candidates.add(`${protocol}://${host}`)
  }
  if (candidates.has(parsed.origin)) return true
  // Local development: the web app and API run on different loopback ports behind Vite's proxy.
  if (process.env.NODE_ENV !== 'production' && isLocal(parsed.hostname)) {
    const requestHost = new URL(input.requestUrl).hostname
    return isLocal(requestHost) || (host ? isLocal(new URL(`http://${host}`).hostname) : false)
  }
  return false
}
