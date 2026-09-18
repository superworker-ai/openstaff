import { tool } from 'ai'
import { z } from 'zod'
import { toolContextSchema } from '../agent/tools.js'
import type { ComposioService } from './service.js'

export function composioTools(service: ComposioService) {
  return {
    composio_search: tool({ description: 'Find up to ten tools from connected apps only. Use request_connection for any other app.', inputSchema: z.object({ query: z.string() }), contextSchema: toolContextSchema, execute: ({ query }, { context }) => service.search(query, context.actorUserId) }),
    composio_execute: tool({ description: 'Execute an app tool discovered through composio_search.', inputSchema: z.object({ slug: z.string(), arguments: z.record(z.string(), z.unknown()) }), contextSchema: toolContextSchema, execute: ({ slug, arguments: args }, { context }) => service.execute(slug, args, context.actorUserId) }),
  }
}
