import { getRequestHeader } from '@tanstack/react-start/server'

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
  }
}

export const authRedirect = (reason: unknown): '/login' | '/two-factor/setup' => reason instanceof ApiError && reason.code === 'two_factor_required' ? '/two-factor/setup' : '/login'

export async function serverApi<T>(path: string): Promise<T> {
  const cookie = getRequestHeader('cookie')
  const origin = process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:8787'
  const response = await fetch(`${origin}${path}`, { headers: cookie ? { cookie } : undefined })
  const body = await response.json() as { error?: string; message?: string; code?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? body.message ?? 'Request failed', body.code)
  return body as T
}
