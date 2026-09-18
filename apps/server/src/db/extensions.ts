import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, uniqueIndex, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { PluginManifest, PluginOAuthAuthorizationServer, Provider } from '@openstaff/shared'
import { rooms } from './schema.js'

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(), name: text('name').notNull().unique(), source: text('source').notNull(),
  rootPath: text('root_path').notNull(), manifest: text('manifest', { mode: 'json' }).$type<PluginManifest>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(), variables: text('variables').notNull(), installedAt: text('installed_at').notNull(),
})
export const providerKeys = sqliteTable('provider_keys', {
  provider: text('provider').$type<Provider>().primaryKey(), encryptedKey: text('encrypted_key').notNull(),
})
export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), toolkit: text('toolkit').notNull(),
  composioConnectedAccountId: text('composio_connected_account_id').notNull().unique(), status: text('status').notNull(), createdAt: text('created_at').notNull(),
  scope: text('scope', { enum: ['workspace', 'member'] }).notNull().default('workspace'), userId: text('user_id'),
}, (table) => [index('connections_toolkit_scope_user_idx').on(table.toolkit, table.scope, table.userId)])
export const roomSummaries = sqliteTable('room_summaries', {
  roomId: text('room_id').primaryKey(), upToSeq: integer('up_to_seq').notNull(), summary: text('summary').notNull(), lastCompactedSeq: integer('last_compacted_seq').notNull(),
})

export const pluginOAuth = sqliteTable('plugin_oauth', {
  lastCheckedAt: text('last_checked_at'),
  refreshError: text('refresh_error'),
  approvalId: text('approval_id'),
  error: text('error'),
  pluginId: text('plugin_id').notNull().references(() => plugins.id, { onDelete: 'cascade' }),
  serverName: text('server_name').notNull(),
  clientInformation: text('client_information'),
  tokens: text('tokens'),
  codeVerifier: text('code_verifier'),
  state: text('state'),
  authorizationServer: text('authorization_server', { mode: 'json' }).$type<PluginOAuthAuthorizationServer>(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.pluginId, table.serverName] }), uniqueIndex('plugin_oauth_state_idx').on(table.state)])

export const oauthClients = sqliteTable('oauth_clients', {
  issuer: text('issuer').primaryKey(), clientId: text('client_id').notNull(), clientSecret: text('client_secret'),
})

export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }), name: text('name').notNull(), trigger: text('trigger', { enum: ['schedule', 'webhook'] }).notNull(),
  cron: text('cron'), timezone: text('timezone').notNull(), prompt: text('prompt').notNull(), targetBotIds: text('target_bot_ids', { mode: 'json' }).$type<string[]>().notNull(),
  overlap: text('overlap', { enum: ['skip', 'queue'] }).notNull(), catchUp: integer('catch_up', { mode: 'boolean' }).notNull().default(false), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  pausedReason: text('paused_reason', { enum: ['manual', 'failures', 'invalid', 'missing_member'] }), consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  webhookKeyHash: text('webhook_key_hash'), lastRunAt: text('last_run_at'), nextRunAt: text('next_run_at'), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('automations_room_idx').on(table.roomId)])

export const automationInvocations = sqliteTable('automation_invocations', {
  id: text('id').primaryKey(), automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }), source: text('source', { enum: ['schedule', 'manual', 'webhook'] }).notNull(),
  scheduledAt: text('scheduled_at'), triggerKey: text('trigger_key'), triggeredBy: text('triggered_by'), messageId: text('message_id'), skipReason: text('skip_reason'), failureCountedAt: text('failure_counted_at'), createdAt: text('created_at').notNull(), completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('automation_invocations_scheduled_unique').on(table.automationId, table.scheduledAt).where(sql`${table.scheduledAt} IS NOT NULL`),
  uniqueIndex('automation_invocations_trigger_unique').on(table.automationId, table.triggerKey).where(sql`${table.triggerKey} IS NOT NULL`),
  index('automation_invocations_automation_created_idx').on(table.automationId, table.createdAt),
])

export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(), invocationId: text('invocation_id').notNull().references(() => automationInvocations.id, { onDelete: 'cascade' }), automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull(), turnId: text('turn_id'), skipReason: text('skip_reason'), createdAt: text('created_at').notNull(),
}, (table) => [index('automation_runs_invocation_idx').on(table.invocationId), index('automation_runs_turn_idx').on(table.turnId)])
