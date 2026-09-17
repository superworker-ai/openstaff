import { z } from 'zod'
import { BOT_ACCESSORIES, BOT_EYES, BOT_MOUTHS, BOT_PERSONALITIES, BOT_SHAPES } from './constants.js'
import { COMPUTER_PROVIDERS } from './computer.js'

export const idSchema = z.string().min(5)
export const isoDateSchema = z.string().datetime()
export const jsonValueSchema = z.json()
export const memberKindSchema = z.enum(['user', 'bot'])
export const authorKindSchema = z.enum(['user', 'bot', 'system'])
export const avatarSchema = z.object({
  shape: z.enum(BOT_SHAPES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  eyes: z.enum(BOT_EYES).optional(),
  mouth: z.enum(BOT_MOUTHS).optional(),
  accessory: z.enum(BOT_ACCESSORIES).optional(),
  personality: z.enum(BOT_PERSONALITIES).optional(),
})
export const mentionSchema = z.object({ kind: memberKindSchema, id: idSchema, handoff: z.literal(true).optional() })

export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  name: z.string(),
  avatar: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  createdAt: isoDateSchema,
})

export const sessionSchema = z.object({
  id: idSchema,
  userId: idSchema,
  expiresAt: isoDateSchema,
})

export const workspaceSchema = z.object({
  id: z.literal('workspace'),
  name: z.string(),
  computerDriver: z.enum(COMPUTER_PROVIDERS),
  defaultModel: z.string(),
  replyDecisionModel: z.string().nullable(),
  settings: z.record(z.string(), jsonValueSchema),
})

/** Experimental switches live in `workspace.settings.experimental`. They are unstable by design. */
const jevExperimentFields = {
  mode: z.enum(['off', 'shadow']),
  model: z.string().trim().min(1).max(64),
  timeoutMs: z.number().int().min(100).max(6000),
  roomIds: z.array(z.string().trim().min(1)).max(50),
}
/** The stored shape: every field resolves to a default. */
export const jevExperimentSchema = z.object({
  mode: jevExperimentFields.mode.default('off'),
  model: jevExperimentFields.model.default('jev-latest'),
  timeoutMs: jevExperimentFields.timeoutMs.default(1200),
  roomIds: jevExperimentFields.roomIds.default([]),
})
/**
 * The edit shape, built from the same field validators so the two cannot drift. It carries no
 * defaults: an omitted key stays omitted, so a partial update merges instead of resetting the
 * fields it did not mention.
 */
export const jevExperimentPatchSchema = z.object({
  mode: jevExperimentFields.mode.optional(),
  model: jevExperimentFields.model.optional(),
  timeoutMs: jevExperimentFields.timeoutMs.optional(),
  roomIds: jevExperimentFields.roomIds.optional(),
}).strict()
/** The browser-action experiment shares the TypeSafe key with the reply experiment but nothing else. */
const jevBrowserExperimentFields = {
  mode: z.enum(['off', 'shadow']),
  model: z.string().trim().min(1).max(64),
  timeoutMs: z.number().int().min(200).max(6000),
  minConfidence: z.number().min(0).max(1),
  roomIds: z.array(z.string().trim().min(1)).max(50),
}
export const jevBrowserExperimentSchema = z.object({
  mode: jevBrowserExperimentFields.mode.default('off'),
  model: jevBrowserExperimentFields.model.default('jev-latest'),
  timeoutMs: jevBrowserExperimentFields.timeoutMs.default(2000),
  minConfidence: jevBrowserExperimentFields.minConfidence.default(0.35),
  roomIds: jevBrowserExperimentFields.roomIds.default([]),
})
export const jevBrowserExperimentPatchSchema = z.object({
  mode: jevBrowserExperimentFields.mode.optional(),
  model: jevBrowserExperimentFields.model.optional(),
  timeoutMs: jevBrowserExperimentFields.timeoutMs.optional(),
  minConfidence: jevBrowserExperimentFields.minConfidence.optional(),
  roomIds: jevBrowserExperimentFields.roomIds.optional(),
}).strict()
export const experimentalSettingsSchema = z.object({ jev: jevExperimentSchema.prefault({}), jevBrowser: jevBrowserExperimentSchema.prefault({}) })
export type JevExperimentSettings = z.infer<typeof jevExperimentSchema>
export type JevExperimentPatch = z.infer<typeof jevExperimentPatchSchema>
export type JevBrowserExperimentSettings = z.infer<typeof jevBrowserExperimentSchema>
export type JevBrowserExperimentPatch = z.infer<typeof jevBrowserExperimentPatchSchema>
export type ExperimentalSettings = z.infer<typeof experimentalSettingsSchema>

/** Never throws: an absent or malformed `experimental` block reads as the defaults. */
export function readExperimentalSettings(settings: Record<string, JsonValue> | null | undefined): ExperimentalSettings {
  return experimentalSettingsSchema.catch(() => experimentalSettingsSchema.parse({})).parse(settings?.experimental)
}

export const botSchema = z.object({
  suggestedApps: z.array(z.string()).optional(),
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  avatar: avatarSchema,
  job: z.string(),
  instructions: z.string(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  approvalPolicy: z.enum(['auto', 'writes', 'all']),
  status: z.enum(['idle', 'working', 'waiting_approval']),
  createdBy: idSchema,
  createdAt: isoDateSchema,
})

export const roomSchema = z.object({
  id: idSchema,
  kind: z.enum(['dm', 'group']),
  name: z.string().nullable(),
  section: z.string().nullable(),
  createdBy: idSchema,
  lastMessageAt: isoDateSchema.nullable(),
  lastMessagePreview: z.string().nullable(),
})

export const roomMemberSchema = z.object({
  roomId: idSchema,
  memberKind: memberKindSchema,
  memberId: idSchema,
  joinedAt: isoDateSchema,
})

export const messageSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  seq: z.number().int().positive(),
  authorKind: authorKindSchema,
  authorId: z.string().nullable(),
  text: z.string(),
  mentions: z.array(mentionSchema),
  attachments: z.array(z.record(z.string(), jsonValueSchema)),
  turnId: idSchema.nullable(),
  clientRequestId: z.string().nullable(),
  createdAt: isoDateSchema,
})

export const turnSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  botId: idSchema,
  triggerMessageId: idSchema,
  replyMode: z.enum(['direct', 'optional']),
  status: z.enum(['queued', 'running', 'waiting_approval', 'done', 'skipped', 'failed', 'cancelled']),
  model: z.string(),
  modelMessages: z.array(jsonValueSchema),
  usage: z.record(z.string(), jsonValueSchema).nullable(),
  error: z.string().nullable(),
  startedAt: isoDateSchema.nullable(),
  finishedAt: isoDateSchema.nullable(),
  handoffDepth: z.number().int().min(0),
  computerProvider: z.enum(COMPUTER_PROVIDERS).nullable().optional(),
})
export const publicTurnSchema = turnSchema.omit({ modelMessages: true })

export const turnEventSchema = z.object({
  id: idSchema,
  turnId: idSchema,
  seq: z.number().int().positive(),
  type: z.enum(['tool-call', 'tool-result', 'text', 'reasoning', 'screenshot', 'status']),
  payload: z.record(z.string(), jsonValueSchema),
  createdAt: isoDateSchema,
})

export const approvalDecisionSchema = z.enum(['approve', 'deny', 'human_completed'])

export const approvalSchema = z.object({
  resumeMode: z.enum(['tool', 'retry', 'connection']).optional(),
  kind: z.enum(['approval', 'connect']).optional(),
  connection: z.object({ source: z.enum(['mcp', 'composio']), pluginId: z.string().optional(), serverName: z.string().optional(), toolkit: z.string().optional(), appName: z.string(), connectUrl: z.string().optional() }).nullable().optional(),
  createdAt: z.string().datetime(),
  id: idSchema,
  turnId: idSchema,
  roomId: idSchema,
  botId: idSchema,
  approvalId: z.string(),
  toolName: z.string(),
  input: jsonValueSchema,
  summary: z.string(),
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  decidedBy: idSchema.nullable(),
  decidedAt: isoDateSchema.nullable(),
})

export const taskSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  title: z.string(),
  brief: z.string(),
  ownerBotId: idSchema,
  createdByKind: memberKindSchema,
  createdById: idSchema,
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
  handoffFromBotId: idSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

export type User = z.infer<typeof userSchema>
export type Session = z.infer<typeof sessionSchema>
export type Workspace = z.infer<typeof workspaceSchema>
export type Bot = z.infer<typeof botSchema>
export type Room = z.infer<typeof roomSchema>
export type RoomMember = z.infer<typeof roomMemberSchema>
export type Message = z.infer<typeof messageSchema>
export type Mention = z.infer<typeof mentionSchema>
export type Turn = z.infer<typeof turnSchema>
export type PublicTurn = z.infer<typeof publicTurnSchema>
export type TurnEvent = z.infer<typeof turnEventSchema>
export type Approval = z.infer<typeof approvalSchema>
export type Task = z.infer<typeof taskSchema>
export type Avatar = z.infer<typeof avatarSchema>
export type JsonValue = z.infer<typeof jsonValueSchema>
