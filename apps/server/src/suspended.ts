import type { MiddlewareHandler } from 'hono'
import type { WorkspaceState } from '@openstaff/shared'
import type { AppEnv } from './api/context.js'

const ALLOWED = new Set(['/api/health', '/api/ready', '/api/plan', '/api/usage/export'])

export function suspendedGate(state: WorkspaceState): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    if (state !== 'suspended' || ALLOWED.has(context.req.path) || context.req.path.startsWith('/api/auth/')) return next()
    return context.json({ error: 'Workspace suspended', code: 'suspended' }, 402)
  }
}
