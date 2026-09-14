import { z } from 'zod'
import { idSchema, isoDateSchema } from './schemas.js'

export const AUTOMATION_TRIGGERS = ['schedule', 'webhook'] as const
export const AUTOMATION_OVERLAP = ['skip', 'queue'] as const
export const INVOCATION_SOURCES = ['schedule', 'manual', 'webhook'] as const
export const INVOCATION_STATUSES = ['running', 'completed', 'partial_failed', 'failed', 'skipped'] as const
export const RUN_STATUSES = ['queued', 'running', 'waiting_approval', 'done', 'skipped', 'failed', 'cancelled'] as const
export const PAUSE_REASONS = ['manual', 'failures', 'invalid', 'missing_member'] as const
export const MAX_AUTOMATION_TARGETS = 5
export const AUTOMATION_FAILURE_LIMIT = 3

export const automationInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  cron: z.string().trim().min(1).nullable(),
  timezone: z.string().trim().min(1).default('UTC'),
  prompt: z.string().trim().min(1).max(20_000),
  roomId: idSchema,
  targetBotIds: z.array(idSchema).min(1).max(MAX_AUTOMATION_TARGETS).refine((ids) => new Set(ids).size === ids.length, 'Target bots must be unique'),
  overlap: z.enum(AUTOMATION_OVERLAP).default('skip'),
  catchUp: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.trigger === 'schedule' && value.cron === null) context.addIssue({ code: 'custom', path: ['cron'], message: 'Cron is required for schedule automations' })
  if (value.trigger === 'webhook' && value.cron !== null) context.addIssue({ code: 'custom', path: ['cron'], message: 'Cron must be null for webhook automations' })
})

export const automationSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  name: z.string(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  cron: z.string().nullable(),
  timezone: z.string(),
  prompt: z.string(),
  targetBotIds: z.array(idSchema),
  overlap: z.enum(AUTOMATION_OVERLAP),
  catchUp: z.boolean(),
  enabled: z.boolean(),
  pausedReason: z.enum(PAUSE_REASONS).nullable(),
  consecutiveFailures: z.number().int().min(0),
  hasWebhookKey: z.boolean(),
  lastRunAt: isoDateSchema.nullable(),
  nextRunAt: isoDateSchema.nullable(),
  createdBy: idSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

export const automationRunSchema = z.object({
  id: idSchema,
  invocationId: idSchema,
  botId: idSchema,
  botName: z.string(),
  turnId: idSchema.nullable(),
  status: z.enum(RUN_STATUSES),
  skipReason: z.string().nullable(),
  error: z.string().nullable(),
})

export const automationInvocationSchema = z.object({
  id: idSchema,
  automationId: idSchema,
  source: z.enum(INVOCATION_SOURCES),
  status: z.enum(INVOCATION_STATUSES),
  scheduledAt: isoDateSchema.nullable(),
  triggerKey: z.string().nullable(),
  triggeredBy: idSchema.nullable(),
  messageId: idSchema.nullable(),
  skipReason: z.string().nullable(),
  createdAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  runs: z.array(automationRunSchema),
})

export type AutomationInput = z.infer<typeof automationInputSchema>
export type Automation = z.infer<typeof automationSchema>
export type AutomationRun = z.infer<typeof automationRunSchema>
export type AutomationInvocation = z.infer<typeof automationInvocationSchema>
export type AutomationRunStatus = z.infer<typeof automationRunSchema>['status']
export type InvocationStatus = z.infer<typeof automationInvocationSchema>['status']
