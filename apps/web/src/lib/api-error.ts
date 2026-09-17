// Client-safe: no server-only imports. server-api.ts re-exports these for loaders.
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
  }
}

export const authRedirect = (reason: unknown): '/login' | '/two-factor/setup' => reason instanceof ApiError && reason.code === 'two_factor_required' ? '/two-factor/setup' : '/login'
