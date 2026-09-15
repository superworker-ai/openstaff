import path from 'node:path'
import { DEFAULT_CONTEXT_MESSAGES, DEFAULT_MAX_CONCURRENT_TURNS, DEFAULT_MODEL, WORKSPACE_PLANS, WORKSPACE_STATES, type WorkspacePlan, type WorkspaceState } from '@openstaff/shared'

export interface Config {
  dataDir: string
  port: number
  maxConcurrentTurns: number
  contextMessages: number
  defaultModel: string
  publicAppUrl?: string
  signupCode?: string
  plan: WorkspacePlan
  state: WorkspaceState
  managedKeys: boolean
  controlPlaneToken?: string
  billingUrl?: string
}

export function readConfig(overrides: Partial<Config> = {}): Config {
  const configuredDataDir = overrides.dataDir ?? process.env.DATA_DIR ?? './data'
  const plan = overrides.plan ?? (process.env.WORKSPACE_PLAN || 'self-hosted')
  const state = overrides.state ?? (process.env.WORKSPACE_STATE || 'active')
  if (!(WORKSPACE_PLANS as readonly string[]).includes(plan)) throw new Error(`WORKSPACE_PLAN must be one of ${WORKSPACE_PLANS.join(', ')}`)
  if (!(WORKSPACE_STATES as readonly string[]).includes(state)) throw new Error(`WORKSPACE_STATE must be one of ${WORKSPACE_STATES.join(', ')}`)
  if (plan !== 'self-hosted' && process.env.COMPUTER_DRIVER === 'local') throw new Error('COMPUTER_DRIVER=local is not allowed on hosted plans')
  return {
    dataDir: path.isAbsolute(configuredDataDir) ? configuredDataDir : path.resolve(import.meta.dirname, '../../..', configuredDataDir),
    port: overrides.port ?? Number(process.env.SERVER_PORT ?? 8787),
    maxConcurrentTurns: overrides.maxConcurrentTurns ?? Number(process.env.MAX_CONCURRENT_TURNS ?? DEFAULT_MAX_CONCURRENT_TURNS),
    contextMessages: overrides.contextMessages ?? Number(process.env.CONTEXT_MESSAGES ?? DEFAULT_CONTEXT_MESSAGES),
    defaultModel: overrides.defaultModel ?? process.env.DEFAULT_MODEL ?? DEFAULT_MODEL,
    publicAppUrl: overrides.publicAppUrl ?? process.env.PUBLIC_APP_URL,
    signupCode: overrides.signupCode ?? process.env.SIGNUP_CODE,
    plan: plan as WorkspacePlan,
    state: state as WorkspaceState,
    managedKeys: overrides.managedKeys ?? ['1', 'true'].includes((process.env.MANAGED_KEYS ?? '').toLowerCase()),
    controlPlaneToken: overrides.controlPlaneToken !== undefined ? overrides.controlPlaneToken || undefined : process.env.CONTROL_PLANE_TOKEN || undefined,
    billingUrl: overrides.billingUrl !== undefined ? overrides.billingUrl || undefined : process.env.PUBLIC_BILLING_URL || undefined,
  }
}
