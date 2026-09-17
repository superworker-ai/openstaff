import type { Hono } from 'hono'
import type { AppVariables } from '../auth/session.js'
import type { ComputerManager } from '../computer/manager.js'
import type { Config } from '../config.js'
import type { Database } from '../db/index.js'
import type { RealtimeHub } from '../realtime/hub.js'
import type { AdmissionService } from '../rooms/admission.js'
import type { TurnScheduler } from '../rooms/scheduler.js'
import type { KeyStore, Secrets } from '../secrets.js'
import type { PluginRegistry } from '../plugins/registry.js'
import type { PluginInstaller } from '../plugins/installer.js'
import type { ComposioService } from '../composio/service.js'
import type { AutomationService } from '../automations/service.js'
import type { ComputerLeaseService } from '../computer/lease.js'
import type { DurableWorkspace } from '../storage/durable.js'
import type { ModelResolver } from '../agent/models.js'
import type { ReplyDecisionExperimentManager } from '../agent/reply-decision.js'
import type { BrowserActionExperimentManager } from '../browser/jev-actions.js'

export type AppEnv = { Variables: AppVariables }
export type ApiApp = Hono<AppEnv>

export interface ApiDependencies {
  secrets: Secrets
  keys: KeyStore
  registry: PluginRegistry
  installer: PluginInstaller
  composio: ComposioService
  automationService: AutomationService
  modelResolver: ModelResolver
  replyDecisionManager: ReplyDecisionExperimentManager
  browserActionManager: BrowserActionExperimentManager
  db: Database
  config: Config
  computer: ComputerManager
  durable: DurableWorkspace
  lease: ComputerLeaseService
  admission: AdmissionService
  scheduler: TurnScheduler
  hub: RealtimeHub
}
