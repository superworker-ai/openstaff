export class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...init?.headers },
    credentials: 'same-origin',
  })
  const body = await response.json() as { error?: string; code?: string }
  if (!response.ok) throw new ApiError(typeof body.error === 'string' ? body.error : 'Request failed', typeof body.code === 'string' ? body.code : undefined)
  return body as T
}

export function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}
