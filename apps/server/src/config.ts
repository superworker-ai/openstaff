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
  authSecret?: string
  authSignup: 'open' | 'code' | 'invite'
  trustedOrigins: string[]
  email: {
    provider: 'console' | 'smtp' | 'resend'
    from?: string
    smtpUrl?: string
    resendApiKey?: string
  }
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
  const signupCode = overrides.signupCode ?? (process.env.SIGNUP_CODE || undefined)
  const authSignup = overrides.authSignup ?? (process.env.AUTH_SIGNUP || (signupCode ? 'code' : 'open'))
  const emailProvider = overrides.email?.provider ?? (process.env.EMAIL_PROVIDER || 'console')
  if (!(WORKSPACE_PLANS as readonly string[]).includes(plan)) throw new Error(`WORKSPACE_PLAN must be one of ${WORKSPACE_PLANS.join(', ')}`)
  if (!(WORKSPACE_STATES as readonly string[]).includes(state)) throw new Error(`WORKSPACE_STATE must be one of ${WORKSPACE_STATES.join(', ')}`)
  if (!['open', 'code', 'invite'].includes(authSignup)) throw new Error('AUTH_SIGNUP must be one of open, code, invite')
  if (!['console', 'smtp', 'resend'].includes(emailProvider)) throw new Error('EMAIL_PROVIDER must be one of console, smtp, resend')
  const emailFrom = overrides.email?.from ?? (process.env.EMAIL_FROM || undefined)
  if (emailProvider !== 'console' && !emailFrom) throw new Error('EMAIL_FROM is required when EMAIL_PROVIDER is not console')
  if (plan !== 'self-hosted' && process.env.COMPUTER_DRIVER === 'local') throw new Error('COMPUTER_DRIVER=local is not allowed on hosted plans')
  const publicAppUrl = overrides.publicAppUrl ?? process.env.PUBLIC_APP_URL
  const trustedOrigins = overrides.trustedOrigins ?? [...new Set([publicAppUrl, ...(process.env.AUTH_TRUSTED_ORIGINS ?? '').split(',').map((value) => value.trim())].filter((value): value is string => Boolean(value)))]
  return {
    dataDir: path.isAbsolute(configuredDataDir) ? configuredDataDir : path.resolve(import.meta.dirname, '../../..', configuredDataDir),
    port: overrides.port ?? Number(process.env.SERVER_PORT ?? 8787),
    maxConcurrentTurns: overrides.maxConcurrentTurns ?? Number(process.env.MAX_CONCURRENT_TURNS ?? DEFAULT_MAX_CONCURRENT_TURNS),
    contextMessages: overrides.contextMessages ?? Number(process.env.CONTEXT_MESSAGES ?? DEFAULT_CONTEXT_MESSAGES),
    defaultModel: overrides.defaultModel ?? process.env.DEFAULT_MODEL ?? DEFAULT_MODEL,
    publicAppUrl,
    signupCode,
    authSecret: overrides.authSecret ?? (process.env.AUTH_SECRET || undefined),
    authSignup: authSignup as Config['authSignup'],
    trustedOrigins,
    email: {
      provider: emailProvider as Config['email']['provider'],
      from: emailFrom,
      smtpUrl: overrides.email?.smtpUrl ?? (process.env.SMTP_URL || undefined),
      resendApiKey: overrides.email?.resendApiKey ?? (process.env.RESEND_API_KEY || undefined),
    },
    plan: plan as WorkspacePlan,
    state: state as WorkspaceState,
    managedKeys: overrides.managedKeys ?? ['1', 'true'].includes((process.env.MANAGED_KEYS ?? '').toLowerCase()),
    controlPlaneToken: overrides.controlPlaneToken !== undefined ? overrides.controlPlaneToken || undefined : process.env.CONTROL_PLANE_TOKEN || undefined,
    billingUrl: overrides.billingUrl !== undefined ? overrides.billingUrl || undefined : process.env.PUBLIC_BILLING_URL || undefined,
  }
}
