import { AuthenticationError, FileNotFoundError, NotFoundError, RateLimitError, ServiceBusyError, TimeoutError } from 'e2b'
import { ComputerError, providerError } from './provider.js'

// A missing file also inherits NotFoundError, but must not reconnect the sandbox.
export function e2bInstanceGone(error: unknown): boolean {
  return error instanceof NotFoundError && !(error instanceof FileNotFoundError)
}
export function e2bError(error: unknown): ComputerError {
  if (error instanceof ComputerError) return error
  if (error instanceof AuthenticationError) return new ComputerError('auth', 'E2B rejected the configured E2B API key')
  if (error instanceof NotFoundError) return new ComputerError('permanent', 'E2B resource no longer exists')
  if (error instanceof RateLimitError || error instanceof ServiceBusyError || error instanceof TimeoutError) return new ComputerError('transient', 'E2B is temporarily unavailable')
  return providerError('E2B', error, 'E2B API key')
}
