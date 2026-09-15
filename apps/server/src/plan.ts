import { count } from 'drizzle-orm'
import { PLAN_LIMITS, type ComputerProviderId, type WorkspacePlan } from '@openstaff/shared'
import type { Config } from './config.js'
import type { Database } from './db/index.js'
import { automations, bots, users } from './db/schema.js'

export type PlanLimitName = 'bots' | 'members' | 'automations' | 'computer_provider'
export type PlanLimitMaximum = number | readonly ComputerProviderId[]

export class PlanLimitError extends Error {
  readonly code = 'plan_limit' as const
  constructor(readonly limit: PlanLimitName, readonly plan: WorkspacePlan, readonly max: PlanLimitMaximum) {
    super(limit === 'computer_provider' ? `Computer provider is not available on the ${plan} plan` : `The ${plan} plan limit for ${limit} has been reached`)
  }
  body() { return { error: this.message, code: this.code, limit: this.limit, plan: this.plan, max: this.max } }
}

async function countedLimit(db: Database, table: typeof bots | typeof users | typeof automations, config: Config, limit: Exclude<PlanLimitName, 'computer_provider'>, max: number | null): Promise<PlanLimitError | undefined> {
  if (max === null) return
  const total = (await db.select({ value: count() }).from(table))[0]?.value ?? 0
  if (total >= max) return new PlanLimitError(limit, config.plan, max)
}

export function checkBotPlan(db: Database, config: Config) { return countedLimit(db, bots, config, 'bots', PLAN_LIMITS[config.plan].maxBots) }
export function checkMemberPlan(db: Database, config: Config) { return countedLimit(db, users, config, 'members', PLAN_LIMITS[config.plan].maxMembers) }
export function checkAutomationPlan(db: Database, config: Config) { return countedLimit(db, automations, config, 'automations', PLAN_LIMITS[config.plan].maxAutomations) }
export function checkComputerProviderPlan(config: Pick<Config, 'plan'>, provider: ComputerProviderId): PlanLimitError | undefined {
  const allowed = PLAN_LIMITS[config.plan].computerProviders
  if (allowed !== 'all' && !allowed.includes(provider)) return new PlanLimitError('computer_provider', config.plan, allowed)
}
