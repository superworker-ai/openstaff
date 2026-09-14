import { getRequestHeader } from '@tanstack/react-start/server'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export async function serverApi<T>(path: string): Promise<T> {
  const cookie = getRequestHeader('cookie')
  const origin = process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:8787'
  const response = await fetch(`${origin}${path}`, { headers: cookie ? { cookie } : undefined })
  const body = await response.json() as { error?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'Request failed')
  return body as T
}
