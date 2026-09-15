import { describe, expect, it } from 'vitest'
import { COMPUTER_PROVIDERS } from './computer.js'
import { HOSTED_COMPUTER_PROVIDERS, PLAN_LIMITS, WORKSPACE_PLANS } from './plans.js'

describe('workspace plans', () => {
  it('defines limits for every plan and excludes local from hosted providers', () => {
    expect(Object.keys(PLAN_LIMITS)).toEqual([...WORKSPACE_PLANS])
    expect(HOSTED_COMPUTER_PROVIDERS).toEqual(COMPUTER_PROVIDERS.filter((provider) => provider !== 'local'))
    expect(PLAN_LIMITS['self-hosted']).toMatchObject({ maxBots: null, maxMembers: null, maxAutomations: null, computerProviders: 'all' })
    expect(PLAN_LIMITS.starter).toMatchObject({ maxBots: 3, maxMembers: 3, maxAutomations: 3 })
    expect(PLAN_LIMITS.team).toMatchObject({ maxBots: 10, maxMembers: 10, maxAutomations: 20, includedCreditsUsd: 20 })
    expect(PLAN_LIMITS.business).toMatchObject({ maxBots: null, maxMembers: 25, maxAutomations: null, includedCreditsUsd: 100 })
  })
})
