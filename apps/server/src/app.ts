import type { Server } from 'node:http'
import './load-env.js'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { readConfig, type Config } from './config.js'
import { createDatabase, type DatabaseHandle } from './db/index.js'
import { ComputerManager } from './computer/manager.js'
import { BrowserService } from './browser/service.js'
import { RoomCompactor } from './agent/compaction.js'
import { uploadRoutes } from './api/uploads.js'
import { usageRoutes } from './api/usage.js'
import { screenRoutes } from './api/screens.js'
import { RealtimeHub } from './realtime/hub.js'
import { AdmissionService } from './rooms/admission.js'
import { AgentRuntime } from './agent/runtime.js'
import { resolveModel, type ModelResolver } from './agent/models.js'
import { replyDecisionExperimentFromEnv, type ReplyDecisionExperiment } from './agent/reply-decision.js'
import { TurnScheduler } from './rooms/scheduler.js'
import { requireAuth } from './auth/session.js'
import { authRoutes } from './api/auth.js'
import { botRoutes } from './api/bots.js'
import { roomRoutes } from './api/rooms.js'
import { approvalRoutes, turnRoutes } from './api/turns.js'
import { taskRoutes } from './api/tasks.js'
import { workspaceRoutes } from './api/workspace.js'
import { users } from './db/schema.js'
import type { ApiDependencies, AppEnv } from './api/context.js'
import { KeyStore, Secrets } from './secrets.js'
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
import { sql } from 'drizzle-orm'
import { ComputerLeaseService } from './computer/lease.js'
import { createWorkspaceStore, type WorkspaceStore } from './storage/index.js'
import { DurableWorkspace } from './storage/durable.js'
import { homeRoutes } from './api/home.js'

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
  config: Config
  database: DatabaseHandle
  dependencies: ApiDependencies
  close: () => Promise<void>
}

export async function createApplication(options: CreateApplicationOptions = {}): Promise<Application> {
  const config = readConfig(options.config)
  const replyDecisionExperiment = options.replyDecisionExperiment ?? replyDecisionExperimentFromEnv(process.env, config.dataDir)
  const database = await createDatabase(config.dataDir, true, config.defaultModel)
  const secrets = await Secrets.open(config.dataDir)
  const store = options.workspaceStore ?? createWorkspaceStore(config.dataDir)
  const durable = new DurableWorkspace(store, database.db)
  const computer = new ComputerManager(`${config.dataDir}/workspace`, database.db, secrets, durable)
  const hub = new RealtimeHub(database.db, () => computer.desktop(), config.publicAppUrl)
  computer.setHub(hub)
  // A broken or unreachable Computer provider must never take the app down: login, settings and
  // provider switching still work, and the status endpoint reports the error.
  try { await computer.initialize() } catch (error) { console.error(`Computer provider failed to open: ${error instanceof Error ? error.message : String(error)}`) }
  const lease = new ComputerLeaseService(database.db, hub)
  computer.setLease(lease)
  hub.setLease(lease)
  const admission = new AdmissionService(database.db, hub)
  const keys = new KeyStore(database.db, secrets)
  await keys.load()
  const registry = new PluginRegistry(database.db, secrets, config.publicAppUrl)
  await registry.rebuild()
  const installer = new PluginInstaller(database.db, config.dataDir, secrets, registry)
  const composio = new ComposioService(database.db, admission, keys, config.dataDir, options.composioClient)
  const automationService = new AutomationService(database.db, admission, options.automationClock, hub)
  const modelResolver: ModelResolver = options.modelResolver ?? ((id, resolve) => resolveModel(id, keys, resolve))
  const compactor = new RoomCompactor(database.db, modelResolver, config.contextMessages)
  const browser = new BrowserService(config.dataDir, () => computer.desktop(), undefined, undefined, { lease })
  const runtime = new AgentRuntime({ browser, db: database.db, computer, durable, admission, hub, registry, composio, automationService, contextMessages: config.contextMessages, modelResolver, replyDecisionExperiment })
  const scheduler = new TurnScheduler(database.db, runtime, admission, hub, config.maxConcurrentTurns, compactor)
  admission.setTurnEnqueuer((newTurns) => scheduler.enqueue(newTurns))
  const dependencies: ApiDependencies = { db: database.db, config, computer, durable, lease, admission, scheduler, hub, secrets, keys, registry, installer, composio, automationService, modelResolver }
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
  app.route('/api/auth', authRoutes(dependencies))
  app.route('/api/hooks', hookRoutes(dependencies))
  app.use('/api/*', requireAuth(database.db))
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
  app.get('/api/users', async (context) => context.json({ users: await database.db.select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar, role: users.role, createdAt: users.createdAt }).from(users).orderBy(users.name) }))
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
  return { app, config, database, dependencies, close: async () => { clearInterval(expiryTimer); composio.stop(); await connectionHealth.stop(); automationService.stop(); lease.close(); await scheduler.shutdown(); await replyDecisionExperiment?.close(); await compactor.close(); await browser.close(); await computer.close(); await registry.mcpPool.close(); hub.close(); database.close() } }
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
