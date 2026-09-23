import { tool } from 'ai'
import { z } from 'zod'
import { toolContextSchema } from '../agent/tools.js'
import type { ComposioService } from './service.js'

export function composioTools(service: ComposioService) {
  return {
    composio_search: tool({
      description: 'Find up to ten tools in connected apps. Query with two or three keywords naming the object and the verb, such as "list issues" or "send email"; pass toolkit to narrow to one app. Results carry the input schema for composio_execute. For an app that is not connected, use request_connection.',
      inputSchema: z.object({ query: z.string().min(1).max(200), toolkit: z.string().min(1).max(64).optional() }),
      contextSchema: toolContextSchema,
      execute: ({ query, toolkit }, { context }) => service.search(query, context.actorUserId, toolkit ? { toolkit } : {}),
    }),
    composio_execute: tool({ description: 'Execute an app tool discovered through composio_search.', inputSchema: z.object({ slug: z.string(), arguments: z.record(z.string(), z.unknown()) }), contextSchema: toolContextSchema, execute: ({ slug, arguments: args }, { context }) => service.execute(slug, args, context.actorUserId) }),
  }
}
