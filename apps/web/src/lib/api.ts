export class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers },
    credentials: 'same-origin',
  })
  const body = await response.json() as { error?: string; message?: string; code?: string }
  if (!response.ok) {
    if (body.code === 'two_factor_required' && typeof window !== 'undefined' && window.location.pathname !== '/two-factor/setup') window.location.assign('/two-factor/setup')
    throw new ApiError(typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : 'Request failed', typeof body.code === 'string' ? body.code : undefined)
  }
  return body as T
}

export function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}
