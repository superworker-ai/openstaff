import { z } from 'zod'
import {
  approvalSchema,
  botSchema,
  messageSchema,
  roomSchema,
  taskSchema,
  turnEventSchema,
  publicTurnSchema,
} from './schemas.js'
import { automationSchema } from './automations.js'
import { computerLeaseSchema } from './computer.js'

export const clientWireMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), roomIds: z.array(z.string()) }),
  z.object({ type: z.literal('ping') }),
])

const timestamp = { ts: z.string().datetime() }

export const serverWireMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('computer.lease'), lease: computerLeaseSchema, ...timestamp }),
  z.object({ type: z.literal('computer.notice'), detail: z.string(), ...timestamp }),
  z.object({ type: z.literal('computer.storage'), storage: z.object({ kind: z.enum(['fs', 's3']), healthy: z.boolean(), bucket: z.string().optional(), fileCount: z.number().int().min(0), lastReconcileAt: z.string().optional(), lastWarning: z.string().optional() }), ...timestamp }),
  z.object({ type: z.literal('connection.updated'), app: z.string(), status: z.enum(['connected', 'expired', 'not connected']), userId: z.string().nullable().optional(), lastCheckedAt: z.string().nullable().optional(), error: z.string().nullable().optional(), ...timestamp }),
  z.object({ type: z.literal('message.created'), message: messageSchema, ...timestamp }),
  z.object({
    type: z.literal('message.delta'),
    roomId: z.string(),
    turnId: z.string(),
    botId: z.string(),
    text: z.string(),
    ...timestamp,
  }),
  z.object({ type: z.literal('turn.updated'), turn: publicTurnSchema, ...timestamp }),
  z.object({
    type: z.literal('turn.event'),
    turnId: z.string(),
    roomId: z.string(),
    event: turnEventSchema,
    ...timestamp,
  }),
  z.object({ type: z.literal('approval.updated'), approval: approvalSchema, ...timestamp }),
  z.object({ type: z.literal('room.updated'), room: roomSchema, ...timestamp }),
  z.object({ type: z.literal('bot.updated'), bot: botSchema, ...timestamp }),
  z.object({ type: z.literal('task.updated'), task: taskSchema, ...timestamp }),
  z.object({ type: z.literal('automation.updated'), roomId: z.string(), automation: automationSchema, ...timestamp }),
  z.object({
    type: z.literal('presence'),
    roomId: z.string(),
    users: z.array(z.object({ id: z.string(), name: z.string() })),
    ...timestamp,
  }),
  z.object({ type: z.literal('pong'), ...timestamp }),
])

export type ClientWireMessage = z.infer<typeof clientWireMessageSchema>
export type ServerWireMessage = z.infer<typeof serverWireMessageSchema>
