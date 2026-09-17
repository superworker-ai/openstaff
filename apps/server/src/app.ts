import type { Server } from 'node:http'
import './load-env.js'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { PLAN_LIMITS } from '@openstaff/shared'
import { eq, sql } from 'drizzle-orm'
import { readConfig, type Config } from './config.js'
import { createDatabase, type DatabaseHandle } from './db/index.js'
import { ComputerManager } from './computer/manager.js'
import { BrowserService } from './browser/service.js'
import { RoomCompactor } from './agent/compaction.js'
import { uploadRoutes } from './api/uploads.js'
import { usageExportRoutes, usageRoutes } from './api/usage.js'
import { screenRoutes } from './api/screens.js'
import { RealtimeHub } from './realtime/hub.js'
import { AdmissionService } from './rooms/admission.js'
import { AgentRuntime } from './agent/runtime.js'
import { resolveModel, type ModelResolver } from './agent/models.js'
import { ReplyDecisionExperimentManager, type ReplyDecisionExperiment } from './agent/reply-decision.js'
import { TurnScheduler } from './rooms/scheduler.js'
import { requireAuth } from './auth/session.js'
import { publicUser } from './auth/session.js'
import { authHandler, createAuth, ssoMutationGuard, type OpenStaffAuth } from './auth/better-auth.js'
import { botRoutes } from './api/bots.js'
import { roomRoutes } from './api/rooms.js'
import { approvalRoutes, turnRoutes } from './api/turns.js'
import { taskRoutes } from './api/tasks.js'
import { workspaceRoutes } from './api/workspace.js'
import { ssoProvider, users, workspace } from './db/schema.js'
import type { ApiDependencies, AppEnv } from './api/context.js'
import { KeyStore, Secrets } from './secrets.js'
import { readExperimentalSettings } from '@openstaff/shared'
import { PluginRegistry } from './plugins/registry.js'
import { PluginInstaller } from './plugins/installer.js'
import { ComposioService } from './composio/service.js'
import type { ComposioClient } from './composio/client.js'
import { AutomationService, type AutomationClock } from './automations/service.js'
import { pluginRoutes } from './api/plugins.js'
import { marketplaceRoutes, connectionRoutes } from './api/marketplace.js'
import { automationRoutes } from './api/automations.js'
import { hookRoutes } from './api/hooks.js'
import { expireApprovals } from './agent/approval-expiry.js'
import { roomConnectionRoutes } from './api/room-connect.js'
import { ConnectionHealth } from './plugins/connection-health.js'
import { computerRoutes } from './api/computer.js'
import { computerDesktopRoutes } from './api/computer-desktop.js'
import { ComputerLeaseService } from './computer/lease.js'
import { createWorkspaceStore, type WorkspaceStore } from './storage/index.js'
import { DurableWorkspace } from './storage/durable.js'
import { homeRoutes } from './api/home.js'
import { suspendedGate } from './suspended.js'
import { createMailer } from './email/index.js'
import { createAuditWriter } from './audit.js'
import { invitationRoutes, memberRoutes, publicInvitationRoutes } from './api/members.js'
import { auditRoutes } from './api/audit.js'
import { securityRoutes } from './api/security.js'

export interface CreateApplicationOptions {
  composioClient?: ComposioClient
  automationClock?: AutomationClock
  config?: Partial<Config>
  modelResolver?: ModelResolver
  workspaceStore?: WorkspaceStore
  replyDecisionExperiment?: ReplyDecisionExperiment
}

export interface Application {
  app: Hono<AppEnv>
  auth: OpenStaffAuth
  config: Config
  database: DatabaseHandle
  dependencies: ApiDependencies
  close: () => Promise<void>
}

export async function createApplication(options: CreateApplicationOptions = {}): Promise<Application> {
  const config = readConfig(options.config)
  if (process.env.JEV_REPLY_MODE) console.warn('JEV_REPLY_MODE is ignored; configure the Jev experiment in Settings → Experimental')
  const database = await createDatabase(config.dataDir, true, config.defaultModel)
  const secrets = await Secrets.open(config.dataDir)
  const sendEmail = createMailer(config)
  const audit = createAuditWriter(database.db)
  const auth = createAuth(config, database.db, { sendEmail, audit })
  const store = options.workspaceStore ?? createWorkspaceStore(config.dataDir)
  const durable = new DurableWorkspace(store, database.db)
  const computer = new ComputerManager(`${config.dataDir}/workspace`, database.db, secrets, durable, config.plan, config.managedKeys)
  const hub = new RealtimeHub(database.db, auth, () => computer.desktop(), config.publicAppUrl, config.state)
  computer.setHub(hub)
  try { await computer.initialize() }
  catch (error) {
    const stored = (await database.db.select({ computerDriver: workspace.computerDriver }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]?.computerDriver
    if (config.plan !== 'self-hosted' && stored === 'local' && error instanceof Error && error.message === 'The local Computer is not available on this plan') console.warn('The stored local Computer is not available on this hosted plan; select a hosted provider in Settings')
    else console.error(`Computer provider failed to open: ${error instanceof Error ? error.message : String(error)}`)
  }
  const lease = new ComputerLeaseService(database.db, hub)
  computer.setLease(lease)
  hub.setLease(lease)
  const admission = new AdmissionService(database.db, hub)
  const keys = new KeyStore(database.db, secrets, config.managedKeys)
  await keys.load()
  // Settings own the experiment, so it is built after the database and key store exist and is
  // rebuilt in place whenever Settings change. No restart, and no boot-time environment reads.
  const replyDecisionManager = new ReplyDecisionExperimentManager(config.dataDir)
  const workspaceRow = (await database.db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
  await replyDecisionManager.configure(readExperimentalSettings(workspaceRow?.settings).jev, keys.get('typesafe'))
  const replyDecisionExperiment = options.replyDecisionExperiment ? () => options.replyDecisionExperiment : () => replyDecisionManager.get()
  const registry = new PluginRegistry(database.db, secrets, config.publicAppUrl)
  await registry.rebuild()
  const installer = new PluginInstaller(database.db, config.dataDir, secrets, registry)
  const composio = new ComposioService(database.db, admission, keys, config.dataDir, options.composioClient, config.composioUserId)
  const automationService = new AutomationService(database.db, admission, options.automationClock, hub)
  const modelResolver: ModelResolver = options.modelResolver ?? ((id, resolve) => resolveModel(id, keys, resolve))
  const compactor = new RoomCompactor(database.db, modelResolver, config.contextMessages)
  const browser = new BrowserService(config.dataDir, () => computer.desktop(), undefined, undefined, { lease })
  const runtime = new AgentRuntime({ browser, db: database.db, computer, durable, admission, hub, registry, composio, automationService, contextMessages: config.contextMessages, modelResolver, replyDecisionExperiment })
  const scheduler = new TurnScheduler(database.db, runtime, admission, hub, config.maxConcurrentTurns, compactor)
  admission.setTurnEnqueuer((newTurns) => scheduler.enqueue(newTurns))
  const dependencies: ApiDependencies = { auth, audit, sendEmail, db: database.db, config, computer, durable, lease, admission, scheduler, hub, secrets, keys, registry, installer, composio, automationService, modelResolver, replyDecisionManager }
  const connectionHealth = new ConnectionHealth(registry.oauth, hub)
  const app = new Hono<AppEnv>()

  const startedAt = Date.now()
  app.get('/api/health', async (context) => {
    const storage = await durable.status()
    try {
      await database.db.run(sql`SELECT 1`)
      const status = await computer.status(), ok = storage.healthy
      return context.json({ ok, version: process.env.APP_VERSION ?? '0.1.0', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), computer: { provider: status.provider, status: status.status }, storage: { kind: storage.kind, healthy: storage.healthy } }, ok ? 200 : 503)
    } catch { return context.json({ ok: false, storage: { kind: storage.kind, healthy: storage.healthy } }, 503) }
  })
  app.get('/api/ready', async (context) => {
    try { await database.db.run(sql`SELECT 1`); return context.json({ ok: true }) } catch { return context.json({ ok: false }, 503) }
  })
  app.get('/api/plan', (context) => context.json({ plan: config.plan, state: config.state, managedKeys: config.managedKeys, billingUrl: config.billingUrl ?? null, limits: PLAN_LIMITS[config.plan] }))
  app.get('/api/auth-config', async (context) => context.json({ password: true, magicLink: true, signup: config.authSignup, socialProviders: Object.keys(config.social), sso: Boolean((await database.db.select({ id: ssoProvider.id }).from(ssoProvider).limit(1))[0]), emailVerification: config.email.provider !== 'console' }))
  const guardSsoMutation = ssoMutationGuard(auth, config)
  for (const path of ['/api/auth/sso/register', '/api/auth/sso/update-provider', '/api/auth/sso/delete-provider', '/api/auth/sso/request-domain-verification', '/api/auth/sso/verify-domain']) app.use(path, guardSsoMutation)
  app.on(['GET', 'POST'], '/api/auth/*', authHandler(auth))
  app.use('/api/*', suspendedGate(config.state))
  app.route('/api/invitations', publicInvitationRoutes(dependencies))
  app.route('/api/hooks', hookRoutes(dependencies))
  app.route('/api/usage/export', usageExportRoutes(dependencies))
  app.use('/api/*', requireAuth(auth, database.db))
  app.route('/api/invitations', invitationRoutes(dependencies))
  app.route('/api/members', memberRoutes(dependencies))
  app.route('/api/audit', auditRoutes(dependencies))
  app.route('/api/security', securityRoutes(dependencies))
  app.route('/api/bots', botRoutes(dependencies))
  app.route('/api/rooms', uploadRoutes(dependencies))
  app.route('/api/usage', usageRoutes(dependencies))
  app.route('/api/rooms', roomRoutes(dependencies))
  app.route('/api/rooms', roomConnectionRoutes(dependencies))
  app.route('/api/turns', turnRoutes(dependencies))
  app.route('/api/approvals', approvalRoutes(dependencies))
  app.route('/api/tasks', taskRoutes(dependencies))
  app.route('/api/workspace', workspaceRoutes(dependencies))
  app.route('/api/plugins', pluginRoutes(dependencies))
  app.route('/api/marketplace', marketplaceRoutes(dependencies))
  app.route('/api/connections', connectionRoutes(dependencies))
  app.route('/api/automations', automationRoutes(dependencies))
  app.route('/api/home', homeRoutes(dependencies))
  app.route('/api/computer', computerRoutes(dependencies))
  app.route('/api/computer/desktop', computerDesktopRoutes(dependencies))
  app.get('/api/users', async (context) => context.json({ users: (await database.db.select().from(users).orderBy(users.name)).map(publicUser) }))
  app.route('/api/screens', screenRoutes(dependencies))
  app.notFound((context) => context.json({ error: 'Not found' }, 404))
  app.onError((error, context) => {
    console.error(error instanceof Error ? error.name : 'Unhandled server error')
    return context.json({ error: 'Internal server error' }, 500)
  })
  await scheduler.recover()
  await automationService.start()
  connectionHealth.start()
  composio.start()
  const expiryTimer = setInterval(() => { void expireApprovals(database.db, hub, Date.now(), admission).catch(() => console.warn('Approval expiry failed')) }, 60_000)
  expiryTimer.unref()
  return { app, auth, config, database, dependencies, close: async () => { clearInterval(expiryTimer); composio.stop(); await connectionHealth.stop(); automationService.stop(); lease.close(); await scheduler.shutdown(); await replyDecisionManager.close(); await compactor.close(); await browser.close(); await computer.close(); await registry.mcpPool.close(); hub.close(); database.close() } }
}

export interface RunningServer extends Application {
  server: ServerType
  url: string
  stop: () => Promise<void>
}

export async function startServer(options: CreateApplicationOptions = {}): Promise<RunningServer> {
  const application = await createApplication(options)
  const server = serve({ fetch: application.app.fetch, port: application.config.port })
  application.dependencies.hub.attach(server as Server)
  await new Promise<void>((resolve) => server.listening ? resolve() : server.once('listening', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : application.config.port
  return {
    ...application,
    server,
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      await application.close()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}
