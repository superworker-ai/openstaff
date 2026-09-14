import { APIError, StreamError } from '@vercel/sandbox'
import { ComputerError, providerError } from './provider.js'

export function vercelInstanceGone(error: unknown): boolean {
  return error instanceof APIError && error.response.status === 404
}

export function vercelError(error: unknown): ComputerError {
  if (error instanceof ComputerError) return error
  if (error instanceof StreamError) return new ComputerError('transient', 'Vercel Sandbox is temporarily unavailable')
  if (error instanceof APIError) return providerError('Vercel Sandbox', error, 'Vercel token')
  // The fs facade raises Node-style errors for missing paths; never treat them as a lost sandbox.
  if ((error as { code?: string })?.code === 'ENOENT') return new ComputerError('permanent', 'Vercel Sandbox path does not exist')
  return providerError('Vercel Sandbox', {}, 'Vercel token')
}
