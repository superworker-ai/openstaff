import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { COMPUTER_PROVIDERS, type AppConnection, type Avatar, type JsonValue } from '@openstaff/shared'
export * from './extensions.js'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
}, (table) => [index('sessions_user_idx').on(table.userId)])

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  computerDriver: text('computer_driver', { enum: COMPUTER_PROVIDERS }).notNull(),
  defaultModel: text('default_model').notNull(),
  replyDecisionModel: text('reply_decision_model'),
  settings: text('settings', { mode: 'json' }).$type<Record<string, JsonValue>>().notNull(),
})

export const bots = sqliteTable('bots', {
  suggestedApps: text('suggested_apps', { mode: 'json' }).$type<string[]>().notNull().default([]),
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  avatar: text('avatar', { mode: 'json' }).$type<Avatar>().notNull(),
  job: text('job').notNull(),
  instructions: text('instructions').notNull(),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  approvalPolicy: text('approval_policy', { enum: ['auto', 'writes', 'all'] }).notNull(),
  status: text('status', { enum: ['idle', 'working', 'waiting_approval'] }).notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
})

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['dm', 'group'] }).notNull(),
  name: text('name'),
  section: text('section'),
  createdBy: text('created_by').notNull().references(() => users.id),
  lastMessageAt: text('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
})

export const roomSections = sqliteTable('room_sections', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  normalizedName: text('normalized_name').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.normalizedName] })])

export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  memberKind: text('member_kind', { enum: ['user', 'bot'] }).notNull(),
  memberId: text('member_id').notNull(),
  joinedAt: text('joined_at').notNull(),
}, (table) => [primaryKey({ columns: [table.roomId, table.memberKind, table.memberId] })])

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  authorKind: text('author_kind', { enum: ['user', 'bot', 'system'] }).notNull(),
  authorId: text('author_id'),
  text: text('text').notNull(),
  mentions: text('mentions', { mode: 'json' }).$type<Array<{ kind: 'user' | 'bot'; id: string }>>().notNull(),
  attachments: text('attachments', { mode: 'json' }).$type<Array<Record<string, JsonValue>>>().notNull(),
  turnId: text('turn_id'),
  clientRequestId: text('client_request_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('messages_room_seq_unique').on(table.roomId, table.seq),
  uniqueIndex('messages_author_request_unique').on(table.authorKind, table.authorId, table.clientRequestId),
  index('messages_room_created_idx').on(table.roomId, table.createdAt),
])

export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  triggerMessageId: text('trigger_message_id').notNull().references(() => messages.id),
  replyMode: text('reply_mode', { enum: ['direct', 'optional'] }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'waiting_approval', 'done', 'skipped', 'failed', 'cancelled'] }).notNull(),
  model: text('model').notNull(),
  modelMessages: text('model_messages', { mode: 'json' }).$type<JsonValue[]>().notNull(),
  usage: text('usage', { mode: 'json' }).$type<Record<string, JsonValue>>(),
  error: text('error'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  handoffDepth: integer('handoff_depth').notNull().default(0),
  computerProvider: text('computer_provider', { enum: COMPUTER_PROVIDERS }),
}, (table) => [index('turns_room_status_idx').on(table.roomId, table.status), index('turns_bot_status_idx').on(table.botId, table.status)])

export const computerCredentials = sqliteTable('computer_credentials', {
  provider: text('provider', { enum: COMPUTER_PROVIDERS }).primaryKey(),
  encrypted: text('encrypted').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').references(() => users.id),
})

export const computerInstances = sqliteTable('computer_instances', {
  id: text('id').primaryKey(),
  provider: text('provider', { enum: COMPUTER_PROVIDERS }).notNull().unique(),
  externalId: text('external_id').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, JsonValue>>().notNull().default({}),
})

export const computerLease = sqliteTable('computer_lease', {
  id: text('id').primaryKey().notNull().default('workspace'),
  ownerKind: text('owner_kind', { enum: ['bot', 'human'] }).notNull(),
  ownerId: text('owner_id'),
  ownerName: text('owner_name'),
  epoch: integer('epoch').notNull().default(0),
  acquiredAt: text('acquired_at').notNull(),
  expiresAt: text('expires_at'),
  heartbeatAt: text('heartbeat_at'),
  reason: text('reason'),
})

export const durableFiles = sqliteTable('durable_files', {
  key: text('key').primaryKey(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  updatedAt: text('updated_at').notNull(),
  source: text('source').notNull(),
  mtime: text('mtime'),
  description: text('description'),
})

export const turnEvents = sqliteTable('turn_events', {
  id: text('id').primaryKey(),
  turnId: text('turn_id').notNull().references(() => turns.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  type: text('type', { enum: ['tool-call', 'tool-result', 'text', 'reasoning', 'screenshot', 'status'] }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, JsonValue>>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('turn_events_turn_seq_unique').on(table.turnId, table.seq)])

export const approvals = sqliteTable('approvals', {
  resumeMode: text('resume_mode', { enum: ['tool', 'retry', 'connection'] }).notNull().default('tool'),
  kind: text('kind', { enum: ['approval', 'connect'] }).notNull().default('approval'),
  connection: text('connection', { mode: 'json' }).$type<AppConnection>(),
  createdAt: text('created_at').notNull(),
  id: text('id').primaryKey(),
  turnId: text('turn_id').notNull().references(() => turns.id, { onDelete: 'cascade' }),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  approvalId: text('approval_id').notNull().unique(),
  toolName: text('tool_name').notNull(),
  input: text('input', { mode: 'json' }).$type<JsonValue>().notNull(),
  summary: text('summary').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied', 'expired'] }).notNull(),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
}, (table) => [index('approvals_status_idx').on(table.status)])

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  brief: text('brief').notNull(),
  ownerBotId: text('owner_bot_id').notNull().references(() => bots.id),
  createdByKind: text('created_by_kind', { enum: ['user', 'bot'] }).notNull(),
  createdById: text('created_by_id').notNull(),
  status: text('status', { enum: ['open', 'in_progress', 'done', 'cancelled'] }).notNull(),
  handoffFromBotId: text('handoff_from_bot_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('tasks_room_owner_idx').on(table.roomId, table.ownerBotId)])
