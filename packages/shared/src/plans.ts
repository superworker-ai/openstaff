import { COMPUTER_PROVIDERS, type ComputerProviderId } from './computer.js'

export const WORKSPACE_PLANS = ['self-hosted', 'starter', 'team', 'business'] as const
export const WORKSPACE_STATES = ['active', 'past_due', 'suspended'] as const
export type WorkspacePlan = typeof WORKSPACE_PLANS[number]
export type WorkspaceState = typeof WORKSPACE_STATES[number]

export interface PlanLimits {
  maxBots: number | null
  maxMembers: number | null
  maxAutomations: number | null
  computerProviders: 'all' | readonly ComputerProviderId[]
  includedCreditsUsd: number
  sso: boolean
}

export const STARTER_MAX_BOTS = 3
export const STARTER_MAX_MEMBERS = 3
export const STARTER_MAX_AUTOMATIONS = 3
export const TEAM_MAX_BOTS = 10
export const TEAM_MAX_MEMBERS = 10
export const TEAM_MAX_AUTOMATIONS = 20
export const BUSINESS_MAX_MEMBERS = 25
export const TEAM_INCLUDED_CREDITS_USD = 20
export const BUSINESS_INCLUDED_CREDITS_USD = 100
export const HOSTED_COMPUTER_PROVIDERS = COMPUTER_PROVIDERS.filter((provider): provider is Exclude<ComputerProviderId, 'local'> => provider !== 'local')

export const PLAN_LIMITS: Record<WorkspacePlan, PlanLimits> = {
  'self-hosted': { maxBots: null, maxMembers: null, maxAutomations: null, computerProviders: 'all', includedCreditsUsd: 0, sso: true },
  starter: { maxBots: STARTER_MAX_BOTS, maxMembers: STARTER_MAX_MEMBERS, maxAutomations: STARTER_MAX_AUTOMATIONS, computerProviders: HOSTED_COMPUTER_PROVIDERS, includedCreditsUsd: 0, sso: false },
  team: { maxBots: TEAM_MAX_BOTS, maxMembers: TEAM_MAX_MEMBERS, maxAutomations: TEAM_MAX_AUTOMATIONS, computerProviders: HOSTED_COMPUTER_PROVIDERS, includedCreditsUsd: TEAM_INCLUDED_CREDITS_USD, sso: false },
  business: { maxBots: null, maxMembers: BUSINESS_MAX_MEMBERS, maxAutomations: null, computerProviders: HOSTED_COMPUTER_PROVIDERS, includedCreditsUsd: BUSINESS_INCLUDED_CREDITS_USD, sso: true },
}

export interface WorkspacePlanDetails {
  plan: WorkspacePlan
  state: WorkspaceState
  managedKeys: boolean
  billingUrl: string | null
  limits: PlanLimits
}
