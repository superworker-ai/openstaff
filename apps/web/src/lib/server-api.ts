import { getRequestHeader } from '@tanstack/react-start/server'
import { ApiError } from './api-error'

export { ApiError, authRedirect } from './api-error'

export async function serverApi<T>(path: string): Promise<T> {
  const cookie = getRequestHeader('cookie')
  const origin = process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:8787'
  const response = await fetch(`${origin}${path}`, { headers: cookie ? { cookie } : undefined })
  const body = await response.json() as { error?: string; message?: string; code?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? body.message ?? 'Request failed', body.code)
  return body as T
}
