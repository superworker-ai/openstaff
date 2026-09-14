import { Errors } from 'freestyle-sandboxes'
import { ComputerError, providerError } from './provider.js'

function status(error: unknown): number | undefined {
  const value = error as { constructor?: { statusCode?: number }; message?: string }
  if (typeof value?.constructor?.statusCode === 'number') return value.constructor.statusCode
  const match = /^(?:HTTP error|Failed to get whoami:)\s+(\d{3})(?:\b|:)/.exec(value?.message ?? '')
  return match ? Number(match[1]) : undefined
}

export function freestyleInstanceGone(error: unknown): boolean {
  return error instanceof Errors.VmNotFoundError || error instanceof Errors.VmDeletedError
}

export function freestyleError(error: unknown): ComputerError {
  if (error instanceof ComputerError) return error
  return providerError('Freestyle', { status: freestyleInstanceGone(error) ? 404 : status(error) }, 'Freestyle API key')
}
