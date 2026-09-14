import { describe, expect, it } from 'vitest'
import type { AutomationRunStatus } from '@openstaff/shared'
import { deriveInvocationStatus } from './status.js'

describe('deriveInvocationStatus', () => {
  const status = (...statuses: AutomationRunStatus[]) => deriveInvocationStatus(statuses.map((value) => ({ status: value })))
  it('derives skipped for no runs or all skipped', () => { expect(status()).toBe('skipped'); expect(status('skipped', 'skipped')).toBe('skipped') })
  it('derives running when any run is active', () => { for (const active of ['queued', 'running', 'waiting_approval'] as const) expect(status('done', active)).toBe('running') })
  it('derives failed when every non-skipped run failed', () => { expect(status('failed')).toBe('failed'); expect(status('skipped', 'failed')).toBe('failed') })
  it('derives partial failure when only some non-skipped runs failed', () => { expect(status('done', 'failed', 'skipped')).toBe('partial_failed') })
  it('derives completed for terminal success, cancellation, and skipped mixes', () => { expect(status('done')).toBe('completed'); expect(status('cancelled', 'skipped')).toBe('completed') })
})
