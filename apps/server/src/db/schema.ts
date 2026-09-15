import { customType, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { COMPUTER_PROVIDERS, type AppConnection, type Avatar, type JsonValue } from '@openstaff/shared'
export * from './extensions.js'

const authDate = customType<{ data: Date; driverData: string }>({
  dataType: () => 'text',
  fromDriver: (value) => new Date(value),
  toDriver: (value) => value.toISOString(),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  name: text('name').notNull(),
  avatar: text('avatar'),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).notNull().default(false),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: authDate('ban_expires'),
  createdAt: authDate('created_at').notNull(),
  updatedAt: authDate('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: authDate('created_at').notNull(),
  updatedAt: authDate('updated_at').notNull(),
  expiresAt: authDate('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
}, (table) => [index('sessions_user_idx').on(table.userId)])

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: authDate('access_token_expires_at'),
  refreshTokenExpiresAt: authDate('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: authDate('created_at').notNull(),
  updatedAt: authDate('updated_at').notNull(),
}, (table) => [uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId), index('account_user_idx').on(table.userId)])

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: authDate('expires_at').notNull(),
  createdAt: authDate('created_at').notNull(),
  updatedAt: authDate('updated_at').notNull(),
}, (table) => [index('verification_identifier_idx').on(table.identifier)])

export const twoFactor = sqliteTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(true),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: authDate('locked_until'),
}, (table) => [index('two_factor_secret_idx').on(table.secret), index('two_factor_user_idx').on(table.userId)])

export const ssoProvider = sqliteTable('sso_provider', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().unique(),
  issuer: text('issuer').notNull(),
  domain: text('domain').notNull(),
  oidcConfig: text('oidc_config'),
  samlConfig: text('saml_config'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  organizationId: text('organization_id'),
  domainVerified: integer('domain_verified', { mode: 'boolean' }).notNull().default(false),
})

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: text('invited_by').notNull().references(() => users.id),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  acceptedAt: text('accepted_at'),
  revokedAt: text('revoked_at'),
}, (table) => [index('invitations_email_idx').on(table.email), index('invitations_pending_idx').on(table.expiresAt, table.acceptedAt, table.revokedAt)])

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorIp: text('actor_ip').notNull(),
  event: text('event').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, JsonValue>>().notNull(),
}, (table) => [index('audit_log_at_idx').on(table.at, table.id), index('audit_log_actor_idx').on(table.actorUserId)])

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
}, (table) => [index('turns_room_status_idx').on(table.roomId, table.status), index('turns_bot_status_idx').on(table.botId, table.status), index('turns_finished_idx').on(table.finishedAt)])

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

export const computerSessions = sqliteTable('computer_sessions', {
  id: text('id').primaryKey(),
  provider: text('provider', { enum: COMPUTER_PROVIDERS }).notNull(),
  externalId: text('external_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  endReason: text('end_reason'),
}, (table) => [index('computer_sessions_provider_ended_idx').on(table.provider, table.endedAt)])

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
