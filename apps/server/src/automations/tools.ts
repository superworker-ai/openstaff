import { tool } from 'ai'
import { z } from 'zod'
import { toolContextSchema } from '../agent/tools.js'
import type { AutomationService } from './service.js'

export function automationTools(service: AutomationService) {
  return { create_automation: tool({
    description: 'Schedule recurring work for this bot in this room using a cron expression.',
    inputSchema: z.object({ name: z.string(), cron: z.string(), timezone: z.string().optional(), prompt: z.string() }),
    contextSchema: toolContextSchema,
    execute: (input, { context }) => service.create({ ...input, trigger: 'schedule', roomId: context.roomId, targetBotIds: [context.botId], cron: input.cron }, context.botId),
  }) }
}
